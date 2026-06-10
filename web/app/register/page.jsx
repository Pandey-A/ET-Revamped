'use client';

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { ToastContainer, toast } from "react-toastify";
import { FiUserPlus, FiMail, FiLock, FiUser } from "react-icons/fi";
import "react-toastify/dist/ReactToastify.css";

export default function Register() {
  const { register } = useAuth();
  const router = useRouter();

  const [formData, setFormData] = useState({
    userName: "",
    email: "",
    password: "",
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await register(formData);
      if (res?.success) {
        toast.success("Signup successful. Please verify your email before signing in.", { theme: "dark" });
        setTimeout(() => router.push("/login"), 2500);
      } else {
        toast.error(res?.message || "Registration Failed.", { theme: "dark" });
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
            <span className="system-tag">New Registry</span>
            <h1>Join the Force</h1>
            <p>
              Start your journey in securing digital truth. Our <span className="text-highlight">Forensic Engine</span> awaits your first scan.
            </p>
            <div className="auth-stat">
              <div className="stat-item">
                <span className="stat-value">256-bit</span>
                <span className="stat-label">Encryption</span>
              </div>
            </div>
          </div>
        </div>

        <div className="login-form-side">
          <div className="glass-login-card">
            <div className="card-header">
              <h2>Register</h2>
              <p>Initialize your investigator profile</p>
            </div>

            <form onSubmit={handleSubmit} className="auth-form">
              <div className="input-group">
                <label><FiUser /> Username</label>
                <input
                  type="text"
                  placeholder="investigator_01"
                  value={formData.userName}
                  onChange={(e) => setFormData({ ...formData, userName: e.target.value })}
                  required
                />
              </div>

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
                  placeholder="At least 8 characters"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                />
              </div>

              <button className="login-submit-btn" type="submit">
                <span>Create Account</span>
                <FiUserPlus />
              </button>
            </form>

            <div className="card-footer">
              <p>Already an investigator? <Link href="/login" className="text-link">Login Here</Link></p>
            </div>
          </div>
        </div>
      </div>

      <Footer />
      <ToastContainer theme="dark" />
    </div>
  );
}
