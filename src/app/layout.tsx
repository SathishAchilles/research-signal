import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import Script from "next/script";
import { Suspense } from "react";
import { CommandBar } from "@/components/CommandBar";
import { GlassNav } from "@/components/glass/GlassNav";
import { GlassRuntime } from "@/components/glass/GlassRuntime";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  weight: ["500", "600"],
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  weight: ["500"],
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Research Signal",
  description: "Weekly AI/ML research brief",
};

// Runs before hydration: applies the persisted "Solid panels" choice and flags Chromium for SVG refraction.
const GLASS_BOOT = `(function(){var d=document.documentElement;
try{if(localStorage.getItem("rs-glass")==="off")d.dataset.glass="off";}catch(e){}
try{var b=navigator.userAgentData&&navigator.userAgentData.brands;
if(b&&b.some(function(x){return x.brand==="Chromium";}))d.dataset.refract="";}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`dark ${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
          <filter id="rs-lens" x="-10%" y="-30%" width="120%" height="160%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="7" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="22" xChannelSelector="R" yChannelSelector="G" result="d" />
            <feGaussianBlur in="d" stdDeviation="1.5" />
          </filter>
        </svg>
        <Script id="rs-glass-boot" strategy="beforeInteractive">
          {GLASS_BOOT}
        </Script>
        <Suspense fallback={null}>
          <GlassNav />
        </Suspense>
        {children}
        <Suspense fallback={null}>
          <CommandBar />
          <GlassRuntime />
        </Suspense>
      </body>
    </html>
  );
}
