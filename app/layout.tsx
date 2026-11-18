import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
const plex = localFont({
  src: [
    { path: "../public/font-0.ttf", weight: "400" },
    { path: "../public/font-1.ttf", weight: "500" },
    { path: "../public/font-2.ttf", weight: "600" },
    { path: "../public/font-3.ttf", weight: "700" },
  ],
  display: "swap",
});
export const metadata: Metadata = {
  title: "ELCenter | Education, connected",
  description:
    "One workspace for your branches, people and learning operations.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${plex.className} bg-slate-50 text-slate-900 antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
