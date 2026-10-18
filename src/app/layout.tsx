import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, Noto_Nastaliq_Urdu, Playfair_Display } from "next/font/google";
import { resolveWebsiteChatConfig } from "@zarghoon/core/website";
import Providers from "@/components/Providers";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ChatWidget from "@/components/chat/ChatWidget";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

// Urdu-script chat messages render in Nastaliq.
const nastaliq = Noto_Nastaliq_Urdu({
  variable: "--font-nastaliq",
  subsets: ["arabic"],
  weight: ["400", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Zarghoon Jewellers",
  description:
    "Handcrafted gold, diamond and gemstone jewellery. Join the Zarghoon Jewellers Family for exclusive updates and offers.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Server-side only: decides whether the chat launcher appears. No secrets are passed to the client.
  const chat = resolveWebsiteChatConfig(process.env);
  return (
    <html
      lang="en"
      className={`${inter.variable} ${playfair.variable} ${nastaliq.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-cream text-charcoal">
        <Providers>
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
          <ChatWidget mode={chat.mode} model={chat.model} />
        </Providers>
      </body>
    </html>
  );
}
