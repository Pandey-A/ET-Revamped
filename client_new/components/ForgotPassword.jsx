'use client';

import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { FiMail, FiLock, FiRefreshCw, FiCheck, FiChevronLeft, FiEye, FiEyeOff } from "react-icons/fi";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

export default function ForgotPasswordCard() {
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [otpDigits, setOtpDigits] = useState(Array(6).fill(""));
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [resendDisabled, setResendDisabled] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef(null);

  const otpRefs = useRef([]);
  otpRefs.current = Array(6).fill(0).map((_, i) => otpRefs.current[i] ?? { current: null });

  useEffect(() => {
    if (countdown <= 0) { setResendDisabled(false); clearInterval(countdownRef.current); }
  }, [countdown]);
  useEffect(() => () => clearInterval(countdownRef.current), []);

  const startCooldown = (sec = 25) => {
    setResendDisabled(true);
    setCountdown(sec);
    clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown((c) => { if (c <= 1) { clearInterval(countdownRef.current); return 0; } return c - 1; });
    }, 1000);
  };

  function normalizeOtpArray(arr) {
    return arr.map((x) => typeof x === "string" && x.trim() ? x.trim().replace(/\D/g, "") : "");
  }

  async function sendEmail(e) {
    e?.preventDefault();
    toast.dismiss();
    if (!email) return toast.error("Please enter your email.");
    setLoading(true);
    try {
      const res = await api.post("/auth/forgot-password", { email });
      toast.success(res.data?.message || "OTP sent (if account exists).");
      setStep(2);
      startCooldown(25);
      setTimeout(() => otpRefs.current[0]?.current?.focus(), 200);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to request OTP");
    } finally { setLoading(false); }
  }

  async function verifyOtp(e) {
    e?.preventDefault();
    toast.dismiss();
    const normalized = normalizeOtpArray(otpDigits);
    const otp = normalized.join("");
    if (!/^\d{6}$/.test(otp)) { toast.error("Enter the 6-digit OTP."); return; }
    setLoading(true);
    try {
      const res = await api.post("/auth/verify-otp", { email, otp });
      if (res.data?.success && res.data?.resetToken) {
        setResetToken(res.data.resetToken);
        toast.success("OTP verified. Set a new password.");
        setStep(3);
      } else {
        toast.error(res.data?.message || "Invalid OTP");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "OTP verification failed");
    } finally { setLoading(false); }
  }

  async function resetPassword(e) {
    e?.preventDefault();
    toast.dismiss();
    if (!newPassword || newPassword.length < 6) return toast.error("Password must be at least 6 characters.");
    if (newPassword !== confirmPw) return toast.error("Passwords do not match.");
    setLoading(true);
    try {
      const res = await api.post("/auth/reset-password", { email, resetToken, newPassword });
      if (res.data?.success) {
        toast.success("Password reset. Redirecting…");
        setTimeout(() => router.push("/login"), 1000);
      } else {
        toast.error(res.data?.message || "Failed to reset password");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Reset failed");
    } finally { setLoading(false); }
  }

  const resend = async () => {
    if (resendDisabled) return;
    toast.dismiss();
    if (!email) return toast.error("Enter your email first to resend OTP.");
    setLoading(true);
    try {
      const res = await api.post("/auth/forgot-password", { email });
      toast.success(res.data?.message || "OTP resent (if account exists).");
      startCooldown(25);
      setTimeout(() => otpRefs.current[0]?.current?.focus(), 200);
    } catch (err) {
      toast.error(err.response?.data?.message || "Resend failed");
    } finally { setLoading(false); }
  };

  function handleOtpChange(e, idx) {
    const digit = (e.target.value || "").replace(/\D/g, "").slice(-1);
    setOtpDigits((prev) => { const copy = [...prev]; copy[idx] = digit; return copy; });
    if (digit && idx < otpRefs.current.length - 1) otpRefs.current[idx + 1]?.current?.focus();
  }

  function updateDigit(char, idx) {
    setOtpDigits((prev) => { const copy = [...prev]; copy[idx] = char; return copy; });
  }

  function handleOtpKeyDown(e, idx) {
    if (e.key === "Backspace") {
      if (otpDigits[idx]) { updateDigit("", idx); }
      else if (idx > 0) { otpRefs.current[idx - 1]?.current?.focus(); updateDigit("", idx - 1); }
    } else if (e.key === "ArrowLeft" && idx > 0) {
      otpRefs.current[idx - 1]?.current?.focus();
    } else if (e.key === "ArrowRight" && idx < 5) {
      otpRefs.current[idx + 1]?.current?.focus();
    }
  }

  function handleOtpPaste(e) {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData("text") || "";
    const digits = pasted.replace(/\D/g, "").slice(0, 6).split("");
    if (digits.length === 0) return;
    setOtpDigits((prev) => { const copy = [...prev]; for (let i = 0; i < 6; i++) copy[i] = digits[i] ?? ""; return copy; });
    const next = Math.min(digits.length, 5);
    setTimeout(() => otpRefs.current[next]?.current?.focus(), 60);
  }

  const stepTitles = ["Email", "OTP", "New password"];

  return (
    <>
      <ToastContainer position="top-right" autoClose={3000} newestOnTop />
      <motion.div className="fp-lobby" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28 }}>
        <div className="fp-glass">
          <div className="fp-top">
            <div className="fp-steps">
              {stepTitles.map((t, i) => {
                const idx = i + 1;
                const active = idx === step;
                const done = idx < step;
                return (
                  <div key={t} className={`step ${active ? "active" : ""} ${done ? "done" : ""}`}>
                    <div className="bubble">{done ? <FiCheck /> : idx}</div>
                    <div className="stitle">{t}</div>
                  </div>
                );
              })}
            </div>
            <button className="fp-close-slim" onClick={() => router.push("/login")} title="Back to login"><FiChevronLeft /></button>
          </div>

          <div className="fp-main">
            <motion.h2 key={step} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              {step === 1 && <>Forgot your password?</>}
              {step === 2 && <>Enter the 6-digit code</>}
              {step === 3 && <>Set a new password</>}
            </motion.h2>

            <motion.p className="fp-sub" key={`sub-${step}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {step === 1 && "Tell us the email for your account — we'll send a one-time code."}
              {step === 2 && "Check your inbox. Paste or type the code below."}
              {step === 3 && "Use a strong password (min 6 chars). You can view the text with the eye icon."}
            </motion.p>

            {step === 1 && (
              <motion.form onSubmit={sendEmail} className="fp-form" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <label className="label">Email</label>
                <div className="input-ctrl">
                  <FiMail className="left-icon" />
                  <input type="email" placeholder="you@domain.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
                </div>
                <div className="fp-row">
                  <button className="btn primary" type="submit" disabled={loading}>{loading ? "Sending…" : "Send code"}</button>
                  <button type="button" className="btn ghost" onClick={() => { setEmail(""); toast.info("Cleared email"); }}>Clear</button>
                </div>
              </motion.form>
            )}

            {step === 2 && (
              <motion.form onSubmit={verifyOtp} className="fp-form" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <div className="otp-wrap" onPaste={handleOtpPaste} role="group" aria-label="6-digit OTP">
                  {otpDigits.map((d, i) => (
                    <motion.input
                      key={i}
                      ref={(el) => { if (!otpRefs.current[i]) otpRefs.current[i] = { current: null }; otpRefs.current[i].current = el; }}
                      className={`otp-input ${d ? "filled" : ""}`}
                      inputMode="numeric"
                      pattern="\d*"
                      maxLength={1}
                      value={d}
                      onChange={(e) => handleOtpChange(e, i)}
                      onKeyDown={(e) => handleOtpKeyDown(e, i)}
                      aria-label={`digit ${i + 1}`}
                      whileFocus={{ scale: 1.04 }}
                    />
                  ))}
                </div>
                <div className="fp-row">
                  <button className="btn primary" type="submit" disabled={loading}>{loading ? "Verifying…" : "Verify"}</button>
                  <button type="button" className="btn ghost" onClick={resend} disabled={resendDisabled || loading} title="Resend code">
                    <FiRefreshCw style={{ marginRight: 8 }} />
                    {resendDisabled ? `Resend (${countdown}s)` : "Resend"}
                  </button>
                </div>
              </motion.form>
            )}

            {step === 3 && (
              <motion.form onSubmit={resetPassword} className="fp-form" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <label className="label">New password</label>
                <div className="input-ctrl pw">
                  <FiLock className="left-icon" />
                  <input type={showNewPw ? "text" : "password"} placeholder="At least 6 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
                  <button type="button" className="eye-btn" onClick={() => setShowNewPw((s) => !s)} aria-label={showNewPw ? "Hide password" : "Show password"}>
                    {showNewPw ? <FiEyeOff /> : <FiEye />}
                  </button>
                </div>
                <label className="label">Confirm password</label>
                <div className="input-ctrl pw">
                  <input type={showConfirmPw ? "text" : "password"} placeholder="Repeat password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} required />
                  <button type="button" className="eye-btn" onClick={() => setShowConfirmPw((s) => !s)} aria-label={showConfirmPw ? "Hide password" : "Show password"}>
                    {showConfirmPw ? <FiEyeOff /> : <FiEye />}
                  </button>
                </div>
                <div className="fp-row">
                  <button className="btn primary" type="submit" disabled={loading}>{loading ? "Resetting…" : "Set new password"}</button>
                  <button type="button" className="btn ghost" onClick={() => { setNewPassword(""); setConfirmPw(""); toast.info("Cleared passwords"); }}>Clear</button>
                </div>
              </motion.form>
            )}
          </div>

          <div className="fp-foot">
            <div className="fp-progress"><div className="bar" style={{ width: `${(step / 3) * 100}%` }} /></div>
            <div className="fp-extra"><small>Secure • One-time codes expire quickly</small></div>
          </div>
        </div>
      </motion.div>
    </>
  );
}
