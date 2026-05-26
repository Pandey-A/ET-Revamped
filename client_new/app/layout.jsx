import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import FloatingChatWidget from "@/components/FloatingChatWidget";

export const metadata = {
  title: "Elevate Trust.in",
  description: "Advanced AI-assisted verifier that detects facial inconsistencies, lip-sync drift, and audio manipulation with confidence.",
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
        <AuthProvider>
          {children}
          <FloatingChatWidget />
        </AuthProvider>
      </body>
    </html>
  );
}

