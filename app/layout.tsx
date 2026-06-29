import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FastSwarm",
  description: "Real-time multi-agent swarm simulation on Cerebras",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
