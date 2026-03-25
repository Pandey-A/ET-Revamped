'use client';

import { useRouter, useSearchParams } from "next/navigation";

export default function Blocked() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const message = searchParams.get("message") || "Your account has been blocked.";
  const blockedUntil = searchParams.get("blockedUntil") || null;

  return (
    <div className="blocked-page">
      <h2 style={{ color: "#ef4444", fontSize: "1.5rem", fontWeight: 700 }}>Account Blocked</h2>
      <p style={{ maxWidth: 680, textAlign: "center", color: "#555" }}>{message}</p>
      {blockedUntil
        ? <p>Blocked until: <strong>{new Date(blockedUntil).toLocaleString()}</strong></p>
        : <p style={{ color: "#888" }}>This block is indefinite.</p>
      }
      <div style={{ marginTop: 12, display: "flex", gap: 12 }}>
        <button onClick={() => router.push("/login")} style={{ padding: "8px 20px", background: "#111", color: "#fff", border: "none", borderRadius: 10, fontWeight: 600 }}>Back to Login</button>
        <button onClick={() => router.push("/")} style={{ padding: "8px 20px", background: "#fff", color: "#111", border: "1px solid rgba(0,0,0,0.15)", borderRadius: 10, fontWeight: 600 }}>Back to Home</button>
      </div>
    </div>
  );
}
