'use client';

import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import AdminPanel from "@/components/AdminPanel";
import { ToastContainer } from "react-toastify";
import Footer from "@/components/Footer";
import "react-toastify/dist/ReactToastify.css";

export default function Admin() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login');
    }
  }, [isLoading, user, router]);

  if (isLoading) {
    return (
      <div className="admin-page admin-page--status">
        <Navbar />
        <div className="admin-nav-spacer" />
        <div className="admin-status-card">Loading admin dashboard...</div>
      </div>
    );
  }

  if (!user) return null;

  if (user.role !== "admin") {
    return (
      <div className="admin-page admin-page--status">
        <Navbar />
        <div className="admin-nav-spacer" />
        <div className="admin-status-card admin-status-card--error">
          Access denied: You do not have permission to view this page.
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <Navbar />
      <div className="admin-nav-spacer" />

      <main className="admin-main">
        <section className="admin-hero" aria-label="Admin dashboard overview">
          <p className="admin-kicker">Control Center</p>
          <h1>Admin Dashboard</h1>
          <p>Monitor accounts, review activity, and manage user access from one place.</p>
        </section>

        <AdminPanel />
      </main>

      <Footer />

      <ToastContainer position="top-right" autoClose={3000} hideProgressBar={false} newestOnTop closeOnClick pauseOnHover theme="colored" />
    </div>
  );
}
