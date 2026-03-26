import type { Metadata } from "next";
import { Nunito, Noto_Sans_TC } from "next/font/google";
import "./globals.css";

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "optional",
  adjustFontFallback: true,
});

const notoSansTC = Noto_Sans_TC({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans-tc",
  display: "optional",
  adjustFontFallback: true,
  preload: true,
});

export const metadata: Metadata = {
  title: "Meeting Transcriber",
  description: "Local meeting recorder and transcriber with Whisper",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW">
      <body
        className={`${nunito.variable} ${notoSansTC.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
