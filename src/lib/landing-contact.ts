// Contact CTA for the landing page: validates the form and builds a pre-filled
// mailto: link. Nothing is sent or stored. Imports only zod (client-safe).
import { z } from "zod";

export const contactSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100, "Keep your name under 100 characters"),
  email: z.string().trim().pipe(z.email("Enter a valid email address")),
  listingUrl: z
    .url({ protocol: /^https?$/, error: "Enter a link starting with http:// or https://" })
    .max(500, "Keep the link under 500 characters")
    .optional(),
  message: z.string().max(1000, "Keep the message under 1000 characters").optional(),
});

export type ContactInput = z.infer<typeof contactSchema>;

/** `mailto:<to>` with a subject and a body holding every field, each value URI-encoded. */
export function buildContactMailto(input: ContactInput, to: string): string {
  const lines = [`Name: ${input.name}`, `Email: ${input.email}`];
  if (input.listingUrl) lines.push(`Listing: ${input.listingUrl}`);
  if (input.message) lines.push("", input.message);
  const subject = "Listing photo enhancement";
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
}
