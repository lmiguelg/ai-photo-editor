"use client";

import { useState, type FormEvent } from "react";
import { buildContactMailto, contactSchema } from "@/lib/landing-contact";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";
const INPUT = `w-full rounded-md border bg-white px-3 py-2 text-base ${FOCUS}`;

type Field = "name" | "email" | "listingUrl" | "message";

const FIELDS: { id: Field; label: string; type?: string; multiline?: boolean }[] = [
  { id: "name", label: "Your name", type: "text" },
  { id: "email", label: "Email", type: "email" },
  { id: "listingUrl", label: "Listing link (optional)", type: "url" },
  { id: "message", label: "Message (optional)", multiline: true },
];

/**
 * Validates the contact fields with Zod and, when valid, opens the visitor's mail app
 * with a pre-filled email. Sends and stores nothing.
 */
export function LandingContactForm({ contactEmail }: { contactEmail: string }) {
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (field: Field) => String(form.get(field) ?? "");
    const optional = (field: Field) => (value(field).trim() === "" ? undefined : value(field));
    const result = contactSchema.safeParse({
      name: value("name"),
      email: value("email"),
      listingUrl: optional("listingUrl")?.trim(),
      message: optional("message"),
    });
    if (!result.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as Field;
        next[field] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    window.location.href = buildContactMailto(result.data, contactEmail);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {FIELDS.map(({ id, label, type, multiline }) => {
        const error = errors[id];
        const props = {
          id: `contact-${id}`,
          name: id,
          "aria-invalid": error ? true : undefined,
          "aria-describedby": error ? `contact-${id}-error` : undefined,
          className: `${INPUT} ${error ? "border-red-700" : "border-neutral-400"}`,
        };
        return (
          <div key={id} className="space-y-1">
            <label htmlFor={`contact-${id}`} className="block text-sm font-medium text-neutral-900">
              {label}
            </label>
            {multiline ? <textarea rows={4} {...props} /> : <input type={type} {...props} />}
            {error ? (
              <p id={`contact-${id}-error`} className="text-sm text-red-800">
                {error}
              </p>
            ) : null}
          </div>
        );
      })}
      <button
        type="submit"
        className={`w-full rounded-md bg-blue-700 px-5 py-3 text-base font-semibold text-white hover:bg-blue-800 sm:w-auto ${FOCUS}`}
      >
        Email us your request
      </button>
    </form>
  );
}
