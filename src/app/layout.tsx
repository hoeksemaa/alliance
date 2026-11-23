import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import Swirl from "@/client/Swirl";
import "./globals.css";

const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito", display: "swap" });

export const metadata: Metadata = {
  title: "Alliance",
  description: "A tank game for friends: move, shoot, give AP, and make (or break) alliances.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#efe3cc",
};

// Set the saved light/dark mode before the first paint, so the page never flashes the wrong theme.
const themeScript = `try{document.documentElement.dataset.mode=localStorage.getItem("alliance-mode")==="dark"?"dark":"light"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={nunito.variable} data-mode="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Swirl />
        {children}
      </body>
    </html>
  );
}
