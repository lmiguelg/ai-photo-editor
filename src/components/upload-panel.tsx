"use client";

import { useRef, useState, type DragEvent } from "react";
import { ROOM_TYPE_LABELS, uploadFileError } from "@/lib/review";
import { RoomTypeSchema, type Photo, type RoomType } from "@/pipeline/schemas";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";
const ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

interface UploadEntry {
  key: number;
  name: string;
  state: "waiting" | "uploading" | "done" | "error";
  message: string;
}

interface UploadPanelProps {
  listingId: string;
  onUploaded: (photo: Photo) => void;
}

/** Room type select plus a drop zone / file picker that uploads files one after another. */
export function UploadPanel({ listingId, onUploaded }: UploadPanelProps) {
  const [roomType, setRoomType] = useState<RoomType>("other");
  const [dragging, setDragging] = useState(false);
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const nextKey = useRef(0);

  function update(key: number, patch: Partial<UploadEntry>) {
    setEntries((current) => current.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)));
  }

  async function upload(files: File[]) {
    const batch = files.map((file) => {
      const error = uploadFileError(file);
      const entry: UploadEntry = {
        key: nextKey.current++,
        name: file.name,
        state: error ? "error" : "waiting",
        message: error ?? "Waiting",
      };
      return { file, entry };
    });
    setEntries((current) => [...batch.map((item) => item.entry), ...current]);

    for (const { file, entry } of batch) {
      if (entry.state === "error") continue;
      update(entry.key, { state: "uploading", message: "Uploading…" });
      const form = new FormData();
      form.append("file", file);
      form.append("roomType", roomType);
      try {
        const res = await fetch(`/api/listings/${listingId}/photos`, { method: "POST", body: form });
        if (res.ok) {
          onUploaded((await res.json()) as Photo);
          update(entry.key, { state: "done", message: "Uploaded" });
        } else {
          const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
          const reason = typeof body?.error === "string" ? body.error : "Upload failed";
          update(entry.key, { state: "error", message: reason });
        }
      } catch {
        update(entry.key, { state: "error", message: "Upload failed" });
      }
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void upload(Array.from(event.dataTransfer.files));
  }

  return (
    <section aria-labelledby="upload-heading" className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <h2 id="upload-heading" className="text-lg font-semibold">
        Upload photos
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="upload-room-type" className="text-sm font-medium">
          Room type for new uploads
        </label>
        <select
          id="upload-room-type"
          value={roomType}
          onChange={(event) => setRoomType(RoomTypeSchema.parse(event.target.value))}
          className={`rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm ${FOCUS}`}
        >
          {RoomTypeSchema.options.map((value) => (
            <option key={value} value={value}>
              {ROOM_TYPE_LABELS[value]}
            </option>
          ))}
        </select>
      </div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm ${
          dragging ? "border-blue-600 bg-blue-50" : "border-neutral-300 bg-neutral-50"
        }`}
      >
        <p>Drop JPG, PNG or WebP photos here (up to 25 MB each), or</p>
        <label
          htmlFor="upload-files"
          className="cursor-pointer rounded-md border border-neutral-300 bg-white px-3 py-1.5 font-medium hover:bg-neutral-100 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-600 has-[:focus-visible]:ring-offset-2"
        >
          Choose files
          <input
            id="upload-files"
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              void upload(files);
            }}
          />
        </label>
      </div>
      <ul aria-live="polite" className="space-y-1 text-sm">
        {entries.map((entry) => (
          <li key={entry.key} className={entry.state === "error" ? "text-red-800" : "text-neutral-700"}>
            <span className="break-all font-medium">{entry.name}</span>: {entry.message}
          </li>
        ))}
      </ul>
    </section>
  );
}
