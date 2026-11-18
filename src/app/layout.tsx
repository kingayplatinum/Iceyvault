import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IceyVault — Virtual Number Services",
  description: "Explore supported virtual number services across countries. Manage eligible orders, rentals and account activity in one secure place.",
  applicationName: "IceyVault",
  icons: { icon: "/icon.svg", shortcut: "/icon.svg" },
  openGraph: {
    title: "IceyVault — Stay connected. Keep control.",
    description: "A simpler home for supported virtual number services.",
    type: "website",
    siteName: "IceyVault",
  },
  twitter: {
    card: "summary",
    title: "IceyVault — Stay connected. Keep control.",
    description: "A simpler home for supported virtual number services.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
