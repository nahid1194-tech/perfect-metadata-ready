import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

import { Toaster } from "@/components/feedback/toaster";
import { SuccessDialog } from "@/components/feedback/success-dialog";
import { ErrorDialog } from "@/components/feedback/error-dialog";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "Perfect Metadata",
    template: "%s · Perfect Metadata",
  },
  description:
    "Generate image metadata for Adobe Stock and Shutterstock, then export to CSV.",
};

const themeScript = `(function(){try{var s=JSON.parse(localStorage.getItem("app-storage"));var t=(s&&s.state&&s.state.theme)||"light";var r=document.documentElement;if(t==="dark"){r.classList.add("dark");}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={spaceGrotesk.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        {children}
        <Toaster />
        <SuccessDialog />
        <ErrorDialog />
      </body>
    </html>
  );
}
