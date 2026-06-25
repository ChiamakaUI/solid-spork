import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Slipstream — Smart Transaction Stack",
  description:
    "Live ops dashboard: Jito bundle lifecycle, dynamic tip engine, and an AI retry agent — over Yellowstone gRPC on Solana mainnet.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
