import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Platform Event Verification",
  description: "Authenticate to Salesforce and verify Platform Events in real time.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
