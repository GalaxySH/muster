import type { Metadata } from "next";
import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
import "./globals.css";

// We import the Font Awesome CSS above; stop the core from injecting it again at
// runtime (which causes a flash of huge icons before CSS loads under SSR).
config.autoAddCss = false;

export const metadata: Metadata = {
  title: "Muster",
  description: "Collects student dining-services availability for the scheduler.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
