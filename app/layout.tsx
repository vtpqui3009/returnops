import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReturnOps · Shop workspace",
  description: "Track return requests, evidence, and shop owner decisions.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
