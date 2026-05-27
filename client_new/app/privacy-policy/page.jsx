import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Privacy Policy | Elevate Trust.in",
  description: "Privacy policy and app details for Elevate Trust.",
};

const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_ORIGIN || "https://elevatetrust.in";
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "support@elevatetrust.in";
const APP_ICON = "/chatops-icon.png";
const CATEGORY = "Security & Deepfake Detection";

export default function PrivacyPolicyPage() {
  return (
    <div>
      <Navbar />
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "40px 20px 64px" }}>
        <h1 style={{ marginBottom: 8 }}>Privacy Policy</h1>
        <p style={{ color: "#555", marginBottom: 28 }}>
          This page provides core privacy and app information for users and platform reviewers.
        </p>

        <section
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 20,
            marginBottom: 24,
            background: "#fff",
          }}
        >
          <h2 style={{ fontSize: "1.1rem", marginBottom: 14 }}>App Information</h2>
          <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 10 }}>
            <strong>App domain</strong>
            <span>{APP_DOMAIN}</span>

            <strong>Contact email</strong>
            <span>{CONTACT_EMAIL}</span>

            <strong>Category</strong>
            <span>{CATEGORY}</span>

            <strong>App icon</strong>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img src={APP_ICON} alt="App icon" width={28} height={28} />
              <code>{APP_ICON}</code>
            </span>
          </div>
        </section>

        <section style={{ color: "#444", lineHeight: 1.65 }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: 10 }}>How We Handle Data</h2>
          <p>
            We use uploaded content and chat messages only to provide AI-assisted deepfake detection and support
            features. We do not sell personal data. Access to operational data is restricted to authorized personnel.
          </p>
          <p>
            If you want your data removed or have any privacy concerns, please contact us at <b>{CONTACT_EMAIL}</b>.
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
