import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default:  "🍋 Team Portal — Easy Lemon",
    template: "%s | 🍋 Team Portal — Easy Lemon",
  },
  description: "Easy Lemon Staff Case Management Portal",
  icons: {
    icon:  [
      { url: '/logos/easylemon-icon-32.webp',  sizes: '32x32',   type: 'image/webp' },
      { url: '/logos/easylemon-icon-192.webp', sizes: '192x192', type: 'image/webp' },
    ],
    apple: { url: '/logos/easylemon-icon-192.webp', sizes: '192x192', type: 'image/webp' },
  },
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