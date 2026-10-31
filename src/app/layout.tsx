import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Photo Editor",
  description: "Improve listing photos, review them locally and export for clients.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
