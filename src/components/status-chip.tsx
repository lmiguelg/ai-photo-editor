"use client";

import { statusChip, type ChipTone } from "@/lib/review";
import type { Photo } from "@/pipeline/schemas";

const TONE_CLASSES: Record<ChipTone, string> = {
  neutral: "border-neutral-300 bg-neutral-100 text-neutral-800",
  busy: "border-blue-300 bg-blue-50 text-blue-900 motion-safe:animate-pulse",
  good: "border-green-300 bg-green-50 text-green-900",
  warn: "border-amber-300 bg-amber-50 text-amber-900",
  bad: "border-red-300 bg-red-50 text-red-900",
};

/** A photo's status or decision as a text label; colour only reinforces it. */
export function StatusChip({ photo }: { photo: Pick<Photo, "status" | "decision"> }) {
  const { label, tone } = statusChip(photo);
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}>
      {label}
    </span>
  );
}
