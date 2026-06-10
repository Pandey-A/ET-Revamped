'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import api from '@/lib/api';

function VerifyEmailContent() {
  const router = useRouter();
  const params = useSearchParams();
  const token = useMemo(() => params.get('token') || '', [params]);

  const [status, setStatus] = useState('pending');
  const [message, setMessage] = useState('Verifying your email. Please wait...');
  const [redirectIn, setRedirectIn] = useState(3);

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      if (!token) {
        setStatus('error');
        setMessage('Verification link is missing or invalid.');
        return;
      }

      try {
        const res = await api.post('/auth/verify-email', { token });
        if (cancelled) return;
        setStatus('success');
        setMessage(res.data?.message || 'Email verified successfully.');
      } catch (err) {
        if (cancelled) return;
        const msg = err?.response?.data?.message || 'Verification failed. Please request a new verification email.';
        setStatus('error');
        setMessage(msg);
      }
    }

    verify();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (status !== 'success') return undefined;

    setRedirectIn(3);
    const intervalId = setInterval(() => {
      setRedirectIn((prev) => {
        if (prev <= 1) {
          clearInterval(intervalId);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const timeoutId = setTimeout(() => {
      router.replace('/login?verified=1');
    }, 3000);

    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [status, router]);

  return (
    <div className="upload-root">
      <Navbar />
      <main className="upload-container" style={{ maxWidth: 820 }}>
        <div className="glass-card" style={{ marginTop: 120 }}>
          <h1 className="report-title" style={{ marginBottom: 10 }}>Email Verification</h1>
          <p style={{ color: '#555', marginBottom: 16 }}>{message}</p>

          {status === 'success' && (
            <>
              <p style={{ color: '#4f46e5', marginBottom: 12, fontSize: '0.92rem' }}>
                Redirecting to login in {redirectIn}s...
              </p>
              <button className="main-upload-btn" onClick={() => router.replace('/login?verified=1')}>
                Continue to Login
              </button>
            </>
          )}

          {status === 'error' && (
            <button className="secondary-upload-btn" onClick={() => router.push('/login')}>
              Back to Login
            </button>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="upload-root">Loading...</div>}>
      <VerifyEmailContent />
    </Suspense>
  );
}
