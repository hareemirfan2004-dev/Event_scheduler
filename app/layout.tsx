import type { Metadata, Viewport } from "next";
import {
  Bricolage_Grotesque,
  Instrument_Sans,
  Spline_Sans_Mono,
} from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

const instrument = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
});

const splineMono = Spline_Sans_Mono({
  variable: "--font-spline-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Saath — find the day everyone's free",
  description:
    "Pool your family's schedules and find the dates when everyone (or most people) can make it.",
};

export const viewport: Viewport = {
  themeColor: "#fcfbf8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${bricolage.variable} ${instrument.variable} ${splineMono.variable} h-full antialiased`}
    >
      <head>
        {/* Runs before first paint: returning users must not see a flash of
            the marketing hero before hydration swaps in their groups hub.
            Pairs with `html[data-groups] .hide-if-groups` in globals.css. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(JSON.parse(localStorage.getItem("saath:groups")||"[]").length)document.documentElement.setAttribute("data-groups","")}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <div className="mx-auto w-full max-w-md flex-1 px-4 pb-24">
          {children}
        </div>
      </body>
    </html>
  );
}
