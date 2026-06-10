'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { fetchMyCredits } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

function statusBadge(status) {
  const map = {
    active: 'bg-emerald-100 text-emerald-800',
    low_balance: 'bg-amber-100 text-amber-800',
    suspended: 'bg-red-100 text-red-800',
  };
  const cls = map[status] || 'bg-gray-100 text-gray-700';
  const label = (status || 'unknown').replace(/_/g, ' ');
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium capitalize ${cls}`}>
      {label}
    </span>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-light text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-gray-900">{value ?? 0}</p>
    </div>
  );
}

export default function CreditsPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/login/');
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      const res = await fetchMyCredits();
      if (cancelled) return;
      if (!res || res.error) {
        setError(
          res?.error ||
            'Could not load credit usage. Ensure Express (port 5001) and FastAPI (port 8000) are running.'
        );
        setLoading(false);
        return;
      }
      setData(res);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isLoading, router]);

  const billing = data?.billing || {};
  const monitoring = data?.monitoring || {};
  const recent = Array.isArray(data?.recent_usage) ? data.recent_usage : [];

  return (
    <div className="min-h-screen bg-[#f7f7f8]">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-28 sm:px-6">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-gray-900">Message credits</h1>
          <p className="mt-2 text-sm font-light text-gray-600">
            Credits apply to WhatsApp and website widget replies for your AI agents. Greeting-only
            messages on WhatsApp do not consume credits.
          </p>
        </div>

        {loading && (
          <p className="text-sm text-gray-500">Loading usage…</p>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <>
            <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-gray-500">Available credits</p>
                    <p className="mt-1 text-4xl font-bold text-gray-900">
                      {billing.available_credits ?? 0}
                    </p>
                  </div>
                  <div className="text-right">
                    {statusBadge(billing.status)}
                    <p className="mt-2 text-sm text-gray-500">
                      Plan: <span className="font-medium text-gray-800">{billing.plan || 'Free'}</span>
                    </p>
                    {billing.plan === 'Pro' || billing.allow_overdraft ? (
                      <p className="text-xs text-gray-400 mt-1">
                        Money balance: {billing.money ?? 0}
                        {billing.allow_overdraft ? ` · Overdraft rate: ${billing.overdraft_rate ?? 0}` : ''}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
              <MetricCard label="WhatsApp messages" value={monitoring.total_whatsapp_messages} />
              <MetricCard label="Widget messages" value={monitoring.total_widget_messages} />
              <MetricCard label="Est. LLM tokens" value={monitoring.total_tokens} />
            </section>

            <section className="mb-8">
              <h2 className="mb-4 text-lg font-medium text-gray-900">Activity</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label="Queries received" value={monitoring.total_queries_received} />
                <MetricCard label="Successful replies" value={monitoring.total_successful_replies} />
                <MetricCard label="Failed replies" value={monitoring.total_failed_replies} />
                <MetricCard label="Greetings (no charge)" value={monitoring.total_greetings_bypassed} />
              </div>
              {monitoring.last_active_at && (
                <p className="mt-3 text-xs text-gray-400">
                  Last activity: {new Date(monitoring.last_active_at).toLocaleString()}
                </p>
              )}
            </section>

            {monitoring.token_usage_per_session &&
              Object.keys(monitoring.token_usage_per_session).length > 0 && (
              <section className="mb-8">
                <h2 className="mb-4 text-lg font-medium text-gray-900">Usage by conversation</h2>
                <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase text-gray-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Conversation</th>
                        <th className="px-4 py-3 font-medium">Credits used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(monitoring.token_usage_per_session)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 20)
                        .map(([, tokens], index) => (
                          <tr key={`usage-${index}`} className="border-b border-gray-50 last:border-0">
                            <td className="px-4 py-3 text-gray-700">Conversation {index + 1}</td>
                            <td className="px-4 py-3 text-gray-700">{tokens}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section>
              <h2 className="mb-4 text-lg font-medium text-gray-900">Recent usage</h2>
              {recent.length === 0 ? (
                <p className="text-sm text-gray-500">No billed messages yet.</p>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-gray-100 bg-gray-50 text-xs uppercase text-gray-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">When</th>
                        <th className="px-4 py-3 font-medium">Channel</th>
                        <th className="px-4 py-3 font-medium">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map((row, i) => (
                        <tr key={`${row.at}-${i}`} className="border-b border-gray-50 last:border-0">
                          <td className="px-4 py-3 text-gray-700">
                            {row.at ? new Date(row.at).toLocaleString() : '—'}
                          </td>
                          <td className="px-4 py-3 capitalize text-gray-700">
                            {(row.channel || '').replace(/_/g, ' ')}
                          </td>
                          <td className="px-4 py-3 text-gray-600">{row.charge_type || 'credit'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {billing.status === 'suspended' && (
              <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Your account is out of credits. Widget and WhatsApp replies are paused until you add
                more credits. Contact support to top up.
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
