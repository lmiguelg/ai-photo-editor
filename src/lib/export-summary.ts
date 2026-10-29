import { exportSelection, ROOM_TYPE_LABELS } from "@/lib/review";
import { RoomTypeSchema, type Listing } from "@/pipeline/schemas";

// The email-ready summary the owner pastes into a message to the client. Pure: no
// `node:*`, sharp or store. It never holds costs, scores, prompts, notes, ids, file
// names or anything about photos left out of the export.

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

export interface ExportSummary {
  html: string;
  text: string;
}

/** A paragraph of plain-text lines, optionally followed by a bulleted list. */
interface Paragraph {
  lines: string[];
  items?: string[];
}

const WRAPPER_STYLE = "font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2937;";
// No CSS `margin`: the word must not appear anywhere in what the client receives.
const UL_STYLE = "padding-left:20px;";

export function buildExportSummary(listing: Pick<Listing, "name" | "clientName" | "photos">): ExportSummary {
  const { included, enhancedCount, originalCount } = exportSelection(listing.photos);
  const total = included.length;
  const clientName = listing.clientName?.trim() ?? "";

  const rooms = RoomTypeSchema.options
    .map((room) => ({ room, count: included.filter((item) => item.photo.roomType === room).length }))
    .filter(({ count }) => count > 0)
    .map(({ room, count }) => `${ROOM_TYPE_LABELS[room]}: ${count}`);

  let enhanced: string;
  if (originalCount > 0) {
    enhanced = `We enhanced ${enhancedCount} of them and kept ${originalCount} as they were because they already looked great.`;
  } else {
    enhanced = total === 1 ? "We enhanced it." : "We enhanced all of them.";
  }

  const paragraphs: Paragraph[] = [
    { lines: [clientName ? `Hi ${clientName},` : "Hi there,"] },
    { lines: [`Your photos for ${listing.name} are ready.`] },
    { lines: [total === 1 ? "1 photo is included:" : `${total} photos are included:`], items: rooms },
    { lines: [enhanced, "Every edit keeps your space true to how it really looks."] },
    { lines: ["Before/after previews are included so you can see the difference at a glance."] },
    { lines: ["Let me know if you'd like anything adjusted."] },
    { lines: ["Best regards,"] },
  ];

  const text = paragraphs
    .map(({ lines, items = [] }) => [lines.join(" "), ...items.map((item) => `- ${item}`)].join("\n"))
    .join("\n\n");

  const body = paragraphs
    .map(({ lines, items }) => {
      const p = `<p>${escapeHtml(lines.join(" "))}</p>`;
      if (!items) return p;
      const list = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
      return `${p}<ul style="${UL_STYLE}">${list}</ul>`;
    })
    .join("");

  return { html: `<div style="${WRAPPER_STYLE}">${body}</div>`, text: `${text}\n` };
}
