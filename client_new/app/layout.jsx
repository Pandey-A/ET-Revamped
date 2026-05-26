import "./globals.css";
import dynamic from "next/dynamic";

const ClientProviders = dynamic(() => import("@/components/ClientProviders"), {
  ssr: false,
});

export const metadata = {
  title: "Elevate Trust.in",
  description:
    "Advanced AI-assisted verifier that detects facial inconsistencies, lip-sync drift, and audio manipulation with confidence.",
  icons: {
    icon: [
      { url: "/favicons/favicon-96x96.png", sizes: "96x96", type: "image/png" },
      { url: "/favicons/favicon.svg", type: "image/svg+xml" },
      { url: "/favicons/favicon.ico" },
    ],
    apple: "/favicons/apple-touch-icon.png",
  },
  manifest: "/favicons/site.webmanifest",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
