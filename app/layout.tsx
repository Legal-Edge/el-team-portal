import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default:  "🍋 Team Portal — Easy Lemon",
    template: "%s | 🍋 Team Portal — Easy Lemon",
  },
  description: "Easy Lemon Staff Case Management Portal",

};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}