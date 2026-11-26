import type { Metadata } from "next";
import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
import "./globals.css";
import "./student.css";
import "./student-pages.css";
import "./student-evidence.css";
import "./student-requests.css";
import "./admin.css";
import "./admin-overview.css";
import "./admin-lists.css";
import "./admin-student.css";
import "./admin-dialogs.css";
import "./admin-grid.css";
import "./admin-schedule.css";
import "./admin-plan.css";
import "./admin-setup.css";
import "./admin-settings.css";

// We import the Font Awesome CSS above; stop the core from injecting it again at
// runtime (which causes a flash of huge icons before CSS loads under SSR).
config.autoAddCss = false;

export const metadata: Metadata = {
  title: { default: "Muster", template: "%s | Muster" },
  description: "Collects student dining-services availability for the scheduler.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
