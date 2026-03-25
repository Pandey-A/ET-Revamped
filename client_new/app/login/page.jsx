'use client';

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { ToastContainer, toast } from "react-toastify";
import { FiLogIn, FiMail, FiLock } from "react-icons/fi";
import "react-toastify/dist/ReactToastify.css";

export default function Login() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/upload";
  const [formData, setFormData] = useState({ email: "", password: "" });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await login(formData);
      if (res?.success) {
        toast.success("Access Granted. Initializing...", { theme: "dark" });
        setTimeout(() => router.push(from), 2000);
      } else {
        toast.error(res?.message || "Authentication Failed.", { theme: "dark" });
      }
    } catch (err) {
      toast.error("System Error. Try again.", { theme: "dark" });
    }
  };

  return (
    <div className="login-page-root">
      <Navbar />
      <div className="login-bg-glow"></div>

      <div className="login-container">
        <div className="login-brand-side">
          <div className="brand-content">
            <span className="system-tag">Secure Gateway</span>
            <h1>Welcome Back</h1>
            <p>
              Resume your investigation. Our <span className="text-highlight">AI Matrix</span> is ready to verify your media.
            </p>

          </div>
        </div>

        <div className="login-form-side">
          <div className="glass-login-card">
            <div className="card-header">
              <h2>Login</h2>
              <p>Enter your credentials to proceed</p>
            </div>

            <form onSubmit={handleSubmit} className="auth-form">
              <div className="input-group">
                <label><FiMail /> Email Address</label>
                <input
                  type="email"
                  placeholder="name@company.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                />
              </div>

              <div className="input-group">
                <label><FiLock /> Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                />
              </div>

              <div className="form-actions">
                <Link href="/forgot-password" className="text-link">Forgot Password?</Link>
              </div>

              <button className="login-submit-btn" type="submit">
                <span>Login to Dashboard</span>
                <FiLogIn />
              </button>
            </form>

            <div className="card-footer">
              <p>New to the platform? <Link href="/register" className="text-link">Create Account</Link></p>
            </div>
          </div>
        </div>
      </div>

      <Footer />
      <ToastContainer theme="dark" />
    </div>
  );
}
