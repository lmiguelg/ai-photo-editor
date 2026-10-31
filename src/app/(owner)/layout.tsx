import Link from "next/link";
import { ProviderModeBanner } from "@/components/provider-mode-banner";

/** Owner chrome (header, mock-mode banner, centred main) for `/` and `/listings/*` only. */
export default function OwnerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-3">
          <Link
            href="/"
            className="rounded text-lg font-semibold hover:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            AI Photo Editor
          </Link>
        </div>
      </header>
      <ProviderModeBanner />
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </>
  );
}
