import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReturnOps · Góc làm việc của shop",
  description: "Theo dõi yêu cầu trả hàng, bằng chứng và quyết định của chủ shop.",
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
    <html lang="vi">
      <body className="antialiased">{children}</body>
    </html>
  );
}
