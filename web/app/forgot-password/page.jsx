'use client';

import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ForgotPasswordCard from "@/components/ForgotPassword";

export default function ForgotPasswordPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <Navbar />
      <main
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "36px 18px",
          background: "radial-gradient(circle at 10% 10%, rgba(99,102,241,0.03), transparent 12%), radial-gradient(circle at 90% 90%, rgba(16,185,129,0.02), transparent 14%)",
        }}
      >
        <ForgotPasswordCard />
      </main>
      <Footer />
    </div>
  );
}
