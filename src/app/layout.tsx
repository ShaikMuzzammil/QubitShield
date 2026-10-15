import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Interactive Quantum Error Correction Simulator",
  description:
    "Phase-2 prototype: an interactive Quantum Error Correction simulator scoped exactly to our Python reference program — 3-qubit bit-flip and phase-flip QEC codes under bit-flip (X), phase-flip (Z) and depolarizing noise, with Monte Carlo performance analysis and a live Bloch-sphere lab.",
  keywords: ["Quantum Error Correction", "QEC", "Bit-Flip Code", "Phase-Flip Code", "Depolarizing Noise", "Bloch Sphere", "Quantum Simulator"],
  authors: [
    { name: "K. Devendra Reddy" },
    { name: "Shaik Muzzammil" },
    { name: "D. Guna Samhith" },
  ],
  creator: "AMRITA VISHWA VIDYAPEETHAM — Department of Computer Science",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <div className="flex min-h-screen flex-col">{children}</div>
        <Toaster />
      </body>
    </html>
  );
}
