import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Muster",
  description: "Collects student dining-services availability for the scheduler.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
