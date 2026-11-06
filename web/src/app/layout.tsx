import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kotha — Speak. Verify. Execute.",
  description:
    "Bangla-first verifiable confidential voice DeFi and cross-chain remittance copilot on NEAR. Prohori Firewall enforces on-chain spending limits, Kotha Voice Enclave speaks inside a private TEE, and Shakkhi On-Chain Vault records the proof.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-intensity="obsidian">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
