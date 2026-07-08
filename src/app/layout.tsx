import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIPR — AI-Powered Document Proofreading",
  description: "Publication-ready manuscripts with 7-pass AI proofreading",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}