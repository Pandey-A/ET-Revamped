'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { useAuth } from '@/context/AuthContext';
import { fetchMyAgents, getApiBaseUrl } from '@/lib/api';
import { getAuthHeaderObject } from '@/lib/authToken';
import {
  generateChatWidgetCodeString,
  generateInstructions,
  generateEmbedScriptTag,
  generateEmbedScriptExplainer,
  getInstallSteps,
  normalizeConfig,
  parseStarterQuestions,
} from '@/lib/widgetCodeGenerator';

const defaultStarters = `What can you help me with?\nHow does pricing work?\nI need support`;

const backendExample = `// Hosted gateway is already implemented in this app:
//   app/api/widget/chat/route.js
// It accepts { agentId, message, sessionId? }, validates the agent, proxies to FastAPI
// POST /chat/stream/chat, and returns { reply } with CORS for embeds.
//
// Example: custom Next.js handler if you fork the product (same contract):
// app/api/widget/chat/route.ts

import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const { agentId, message } = await req.json();
  if (!message || typeof message !== 'string') {
    return NextResponse.json({ error: 'message required' }, { status: 400 });
  }

  const reply = \`Echo (\${agentId}): \${message}\`;
  return NextResponse.json({ reply });
}
`;

const backendExampleJs = `// Example: Express — same JSON contract as /api/widget/chat
// server.js

app.post('/api/widget/chat', express.json(), async (req, res) => {
  const { agentId, message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  const reply = \`Echo (\${agentId}): \${message}\`;
  res.json({ reply });
});
`;

const GEN_MIN_MS = 720;

function CopyButton({ text, label = 'Copy', disabled = false }) {
  const [done, setDone] = useState(false);
  const onCopy = useCallback(() => {
    if (!text || disabled) return;
    void navigator.clipboard.writeText(text).then(() => {
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    });
  }, [text, disabled]);
  return (
    <button
      type="button"
      onClick={onCopy}
      disabled={disabled || !text}
      className="rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {done ? 'Copied' : label}
    </button>
  );
}

function CodeSkeleton() {
  return (
    <div className="animate-pulse space-y-3 rounded-xl bg-neutral-950 p-4">
      <div className="h-3 w-2/3 rounded bg-neutral-800" />
      <div className="h-3 w-full rounded bg-neutral-800" />
      <div className="h-3 w-5/6 rounded bg-neutral-800" />
      <div className="h-3 w-4/5 rounded bg-neutral-800" />
      <div className="h-3 w-full rounded bg-neutral-800" />
      <div className="h-3 w-3/4 rounded bg-neutral-800" />
    </div>
  );
}

function SnippetCard({ label, code }) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-950 shadow-inner">
      <div className="flex items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2">
        <span className="truncate font-mono text-xs font-medium text-neutral-400">{label}</span>
        <CopyButton text={code} label="Copy" />
      </div>
      <pre className="max-h-56 overflow-auto p-3 text-xs leading-relaxed text-neutral-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Production origin used in generated code, embed tag, and env examples (override with NEXT_PUBLIC_APP_ORIGIN). */
const WIDGET_LIVE_ORIGIN = 'https://chatiq.co.in';

async function apiFetch(path, opts = {}) {
  const url = `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const isJsonBody = typeof opts.body === 'string';
  const baseHeaders = {
    ...getAuthHeaderObject(),
    ...(isJsonBody ? { 'Content-Type': 'application/json' } : {}),
  };
  return fetch(url, {
    credentials: 'include',
    ...opts,
    headers: { ...baseHeaders, ...opts.headers },
  });
}

export default function WidgetGeneratorPage() {
  const { isAuthenticated } = useAuth();
  const [agentList, setAgentList] = useState([]);
  const [chatbotName, setChatbotName] = useState('Support Bot');
  const [logoUrl, setLogoUrl] = useState('');
  /** Set when the user picks an agent; not shown as raw id in the UI. */
  const [agentId, setAgentId] = useState('default-agent');
  const [starterRaw, setStarterRaw] = useState(defaultStarters);
  const [themeColor, setThemeColor] = useState('#2563eb');
  const [welcomeMessage, setWelcomeMessage] = useState('Hi! Ask us anything.');
  const [position, setPosition] = useState('bottom-right');
  const [framework, setFramework] = useState('next');
  const [typescript, setTypescript] = useState(true);
  const [apiBaseUrl, setApiBaseUrl] = useState(() => {
    const fromEnv = (process.env.NEXT_PUBLIC_APP_ORIGIN || '').replace(/\/$/, '');
    return fromEnv || WIDGET_LIVE_ORIGIN;
  });
  const [scriptOrigin, setScriptOrigin] = useState(() => {
    const fromEnv = (process.env.NEXT_PUBLIC_APP_ORIGIN || '').replace(/\/$/, '');
    return fromEnv || WIDGET_LIVE_ORIGIN;
  });
  const [tab, setTab] = useState('code');

  const [isGenerating, setIsGenerating] = useState(false);
  const [bundle, setBundle] = useState(null);
  /** Live preview: closed = floating button only (like real widget); open = panel */
  const [previewOpen, setPreviewOpen] = useState(false);

  const form = useMemo(
    () => ({
      chatbotName,
      logoUrl,
      agentId,
      starterQuestionsRaw: starterRaw,
      themeColor,
      welcomeMessage,
      position,
      apiBaseUrl,
    }),
    [chatbotName, logoUrl, agentId, starterRaw, themeColor, welcomeMessage, position, apiBaseUrl]
  );

  const prefsKey = useMemo(
    () =>
      JSON.stringify({
        ...form,
        framework,
        typescript,
        scriptOrigin,
      }),
    [form, framework, typescript, scriptOrigin]
  );

  const isDirty = bundle != null && prefsKey !== bundle.prefsKey;

  const previewStarters = useMemo(() => parseStarterQuestions(starterRaw), [starterRaw]);

  const previewCorner = position === 'bottom-left' ? 'left-4 sm:left-5' : 'right-4 sm:right-5';

  useEffect(() => {
    setPreviewOpen(false);
  }, [position]);

  useEffect(() => {
    if (!isAuthenticated) {
      setAgentList([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const data = await fetchMyAgents();
      if (cancelled) return;
      setAgentList(Array.isArray(data) ? data : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const onLogoFile = useCallback(async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    
    const formData = new FormData();
    formData.append('file', f);
    
    try {
      const res = await apiFetch('/upload/logo', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.message || data.error || 'Upload failed');
      
      if (data.url) {
        // Construct the absolute URL using the apiBaseUrl state so the generated widget gets a full link
        const absoluteUrl = `${apiBaseUrl}${data.url}`;
        setLogoUrl(absoluteUrl);
      }
    } catch (err) {
      console.error('Could not upload logo:', err);
    }
  }, [apiBaseUrl]);

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      const snapshot = {
        chatbotName,
        logoUrl,
        agentId,
        starterQuestionsRaw: starterRaw,
        themeColor,
        welcomeMessage,
        position,
        apiBaseUrl,
      };
      const fw = framework;
      const ts = typescript;
      const origin = scriptOrigin;

      const normalized = normalizeConfig(snapshot);
      const opts = { framework: fw, typescript: ts };

      const [componentCode, instructions, embedTag, installSteps] = await Promise.all([
        Promise.resolve(generateChatWidgetCodeString(normalized, opts)),
        Promise.resolve(generateInstructions(normalized, opts)),
        Promise.resolve(generateEmbedScriptTag(normalized, origin)),
        Promise.resolve(getInstallSteps(snapshot, opts)),
      ]);

      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      const wait = Math.max(0, GEN_MIN_MS - elapsed);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));

      setBundle({
        prefsKey: JSON.stringify({
          ...snapshot,
          framework: fw,
          typescript: ts,
          scriptOrigin: origin,
        }),
        normalized,
        framework: fw,
        typescript: ts,
        scriptOrigin: origin,
        componentCode,
        instructions,
        embedTag,
        installSteps,
        generatedLabel: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      });
    } finally {
      setIsGenerating(false);
    }
  }, [
    chatbotName,
    logoUrl,
    agentId,
    starterRaw,
    themeColor,
    welcomeMessage,
    position,
    apiBaseUrl,
    framework,
    typescript,
    scriptOrigin,
  ]);

  const outputFilename = bundle ? (bundle.typescript ? 'ChatWidget.tsx' : 'ChatWidget.jsx') : 'ChatWidget.tsx';

  return (
    <div className="min-h-screen bg-[#fafafa] text-neutral-900">
      <Navbar />

      <main className="mx-auto max-w-6xl px-4 pb-24 pt-28 sm:px-6 lg:px-8">
        <header className="mb-10 max-w-3xl">
          <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">Developers</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Chat widget code generator</h1>
          <p className="mt-3 text-base leading-relaxed text-neutral-600">
            Tune your assistant, then press <strong className="font-medium text-neutral-800">Generate widget code</strong> to build
            snippets from your preferences. The widget calls{' '}
            <code className="rounded bg-neutral-200/80 px-1.5 py-0.5 text-sm">POST /api/widget/chat</code> on your app origin with a{' '}
            <code className="rounded bg-neutral-200/80 px-1.5 py-0.5 text-sm">message</code> (and optional{' '}
            <code className="rounded bg-neutral-200/80 px-1.5 py-0.5 text-sm">sessionId</code>); responses use{' '}
            <code className="rounded bg-neutral-200/80 px-1.5 py-0.5 text-sm">reply</code>. The agent is fixed inside generated code—pick it below if you are an admin.
          </p>
        </header>

        <div className="grid gap-10 lg:grid-cols-12">
          <section className="lg:col-span-5">
            <div className="rounded-2xl border border-neutral-200/80 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold">Configuration</h2>
                {isDirty && (
                  <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-200/80">
                    Unsaved changes
                  </span>
                )}
              </div>
              <div className="mt-6 space-y-5">
                <label className="block text-sm font-medium text-neutral-700">
                  Chatbot name
                  <input
                    className="mt-1.5 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-300"
                    value={chatbotName}
                    onChange={(e) => setChatbotName(e.target.value)}
                  />
                </label>

                <label className="block text-sm font-medium text-neutral-700">
                  Logo URL
                  <input
                    className="mt-1.5 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-300"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://…"
                  />
                </label>

                <label className="block text-sm font-medium text-neutral-700">
                  Upload logo (stored as data URL in generated defaults)
                  <input
                    type="file"
                    accept="image/*"
                    className="mt-1.5 block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-neutral-800"
                    onChange={onLogoFile}
                  />
                </label>

                {isAuthenticated && agentList.length > 0 && (
                  <label className="block text-sm font-medium text-neutral-700">
                    Agent
                    <select
                      className="mt-1.5 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-300"
                      value=""
                      onChange={(e) => {
                        const id = e.target.value;
                        if (!id) return;
                        setAgentId(id);
                        const a = agentList.find((x) => x.id === id);
                        if (a?.name) setChatbotName(a.name);
                        if (a?.greeting_message) setWelcomeMessage(a.greeting_message);
                        e.target.value = '';
                      }}
                    >
                      <option value="">— Select an agent —</option>
                      {agentList.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name?.trim() ? a.name.trim() : 'Unnamed agent'}
                        </option>
                      ))}
                    </select>
                  </label>
                )}



                <label className="block text-sm font-medium text-neutral-700">
                  Starter questions (one per line)
                  <textarea
                    rows={4}
                    className="mt-1.5 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-300"
                    value={starterRaw}
                    onChange={(e) => setStarterRaw(e.target.value)}
                  />
                </label>

                <label className="block text-sm font-medium text-neutral-700">
                  Theme color
                  <div className="mt-1.5 flex gap-3">
                    <input
                      type="color"
                      value={themeColor.length === 7 ? themeColor : '#2563eb'}
                      onChange={(e) => setThemeColor(e.target.value)}
                      className="h-10 w-14 cursor-pointer rounded border border-neutral-200 bg-white p-1"
                    />
                    <input
                      className="min-w-0 flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-300"
                      value={themeColor}
                      onChange={(e) => setThemeColor(e.target.value)}
                    />
                  </div>
                </label>

                <label className="block text-sm font-medium text-neutral-700">
                  Welcome message
                  <input
                    className="mt-1.5 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-300"
                    value={welcomeMessage}
                    onChange={(e) => setWelcomeMessage(e.target.value)}
                  />
                </label>

                <fieldset>
                  <legend className="text-sm font-medium text-neutral-700">Position</legend>
                  <div className="mt-2 flex gap-4 text-sm">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="pos"
                        checked={position === 'bottom-right'}
                        onChange={() => setPosition('bottom-right')}
                      />
                      Bottom right
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="pos"
                        checked={position === 'bottom-left'}
                        onChange={() => setPosition('bottom-left')}
                      />
                      Bottom left
                    </label>
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="text-sm font-medium text-neutral-700">Framework</legend>
                  <div className="mt-2 flex flex-wrap gap-4 text-sm">
                    <label className="inline-flex items-center gap-2">
                      <input type="radio" name="fw" checked={framework === 'next'} onChange={() => setFramework('next')} />
                      Next.js (App Router)
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input type="radio" name="fw" checked={framework === 'vite'} onChange={() => setFramework('vite')} />
                      Vite.js
                    </label>
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="text-sm font-medium text-neutral-700">Code language</legend>
                  <div className="mt-2 flex gap-4 text-sm">
                    <label className="inline-flex items-center gap-2">
                      <input type="radio" name="lang" checked={typescript} onChange={() => setTypescript(true)} />
                      TypeScript
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input type="radio" name="lang" checked={!typescript} onChange={() => setTypescript(false)} />
                      JavaScript
                    </label>
                  </div>
                </fieldset>


              </div>

              <div className="mt-8 border-t border-neutral-100 pt-6">
                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  disabled={isGenerating}
                  className="relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-b from-neutral-900 to-black px-4 py-3.5 text-sm font-semibold text-white shadow-[0_12px_40px_-12px_rgba(0,0,0,0.45)] transition hover:opacity-[0.97] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isGenerating && (
                    <span
                      className="pointer-events-none absolute inset-0 animate-pulse bg-white/[0.08]"
                      aria-hidden
                    />
                  )}
                  {isGenerating ? (
                    <>
                      <svg className="h-4 w-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path
                          className="opacity-90"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      Generating…
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4 shrink-0 opacity-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Generate widget code
                    </>
                  )}
                </button>
                <p className="mt-2 text-center text-xs text-neutral-500">
                  {bundle
                    ? `Last generated at ${bundle.generatedLabel}. Change options and generate again to refresh all tabs.`
                    : 'Outputs appear after your first generate — tabs stay in sync with that snapshot.'}
                </p>
              </div>
            </div>
          </section>

          <section className="lg:col-span-7">
            <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-neutral-200 pb-4">
              {[
                { id: 'code', label: 'Component code' },
                { id: 'instructions', label: 'Install & placement' },
                { id: 'embed', label: 'Embed script' },
                { id: 'api', label: 'Backend example' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    tab === t.id
                      ? 'bg-neutral-900 text-white'
                      : 'bg-white text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {!bundle && !isGenerating && tab !== 'api' && (
              <div className="mb-6 rounded-2xl border border-dashed border-neutral-300 bg-white/80 px-5 py-10 text-center shadow-sm">
                <p className="text-sm font-medium text-neutral-800">No generated bundle yet</p>
                <p className="mx-auto mt-2 max-w-md text-sm text-neutral-600">
                  Use <span className="font-medium text-neutral-900">Generate widget code</span> in the panel on the left. You will
                  see a short progress state, then this tab will fill with code matched to your framework and language.
                </p>
              </div>
            )}

            {tab === 'code' && (
              <div className="relative rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{outputFilename}</h2>
                    {bundle && (
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {bundle.framework === 'next' ? 'Next.js' : 'Vite'} · {bundle.typescript ? 'TypeScript' : 'JavaScript'}
                      </p>
                    )}
                  </div>
                  <CopyButton text={bundle?.componentCode ?? ''} disabled={!bundle || isGenerating} />
                </div>
                <div className="relative min-h-[200px]">
                  {isGenerating && !bundle?.componentCode && <CodeSkeleton />}
                  {bundle?.componentCode && (
                    <pre
                      className={`max-h-[min(70vh,640px)] overflow-auto rounded-xl bg-neutral-950 p-4 text-xs leading-relaxed text-neutral-100 ${isGenerating ? 'opacity-40' : ''}`}
                    >
                      <code>{bundle.componentCode}</code>
                    </pre>
                  )}
                  {isGenerating && bundle?.componentCode && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-white/30 backdrop-blur-[1px]">
                      <span className="flex items-center gap-2 rounded-full bg-neutral-900 px-4 py-2 text-xs font-semibold text-white shadow-lg">
                        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Regenerating…
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'instructions' && (
              <div className="space-y-6">
                {!bundle?.installSteps ? (
                  <div className="rounded-2xl border border-neutral-200/80 bg-white p-8 text-center text-sm text-neutral-600 shadow-sm">
                    Generate widget code to see install steps for your stack.
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-neutral-200/80 bg-gradient-to-br from-white to-neutral-50 p-6 shadow-sm">
                      <div>
                        <h2 className="text-xl font-semibold tracking-tight text-neutral-900">Install & placement</h2>
                        <p className="mt-2 max-w-xl text-sm leading-relaxed text-neutral-600">
                          Follow these steps in order. Paths assume a typical{' '}
                          <span className="font-medium text-neutral-800">{bundle.framework === 'next' ? 'Next.js App Router' : 'Vite + React'}</span>{' '}
                          layout — adjust if your repo differs.
                        </p>
                      </div>
                      <CopyButton text={bundle.instructions} label="Copy all (markdown)" disabled={isGenerating} />
                    </div>

                    <ol className="space-y-5">
                      {bundle.installSteps.map((step) => (
                        <li
                          key={step.step}
                          className="relative overflow-hidden rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-sm ring-1 ring-black/[0.03]"
                        >
                          <div className="flex gap-4">
                            <div
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-inner"
                              style={{ background: 'linear-gradient(145deg, #262626, #0a0a0a)' }}
                            >
                              {step.step}
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3 className="text-base font-semibold text-neutral-900">{step.title}</h3>
                              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-neutral-600 [&_code]:rounded [&_code]:bg-neutral-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]">
                                {step.body}
                              </p>
                              {step.snippets?.length > 0 && (
                                <div className="mt-4 space-y-3">
                                  {step.snippets.map((s) => (
                                    <SnippetCard key={s.label} label={s.label} code={s.code} />
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ol>

                    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5 text-sm leading-relaxed text-indigo-950">
                      <p className="font-semibold text-indigo-950">JavaScript vs TypeScript</p>
                      <p className="mt-2 text-indigo-900/90">
                        If you picked JavaScript, the component file ends in <code className="rounded bg-white/80 px-1.5 py-0.5 font-mono text-xs">.jsx</code> and drops exported types and generics — props stay the same, so these steps still apply.
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === 'embed' && (
              <div className="space-y-6">
                {!bundle?.embedTag ? (
                  <div className="rounded-2xl border border-neutral-200/80 bg-white p-8 text-center text-sm text-neutral-600 shadow-sm">
                    Generate widget code to build the embed snippet (uses your script origin and agent settings).
                  </div>
                ) : (
                  <>
                    <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-sm">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-lg font-semibold">Script tag</h2>
                        <CopyButton text={bundle.embedTag} disabled={isGenerating} />
                      </div>
                      <pre className="overflow-auto rounded-xl bg-neutral-950 p-4 text-xs leading-relaxed text-neutral-100">
                        <code>{bundle.embedTag}</code>
                      </pre>
                    </div>
                    <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 text-sm leading-relaxed text-neutral-700 shadow-sm">
                      <h3 className="text-base font-semibold text-neutral-900">How the embed script works</h3>
                      <p className="mt-2 whitespace-pre-line">{generateEmbedScriptExplainer()}</p>
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === 'api' && (
              <div className="space-y-6">
                <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-sm">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold">Next.js route (TypeScript)</h2>
                    <CopyButton text={backendExample} />
                  </div>
                  <pre className="max-h-80 overflow-auto rounded-xl bg-neutral-950 p-4 text-xs leading-relaxed text-neutral-100">
                    <code>{backendExample}</code>
                  </pre>
                </div>
                <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-sm">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold">Express (JavaScript)</h2>
                    <CopyButton text={backendExampleJs} />
                  </div>
                  <pre className="max-h-64 overflow-auto rounded-xl bg-neutral-950 p-4 text-xs leading-relaxed text-neutral-100">
                    <code>{backendExampleJs}</code>
                  </pre>
                </div>
              </div>
            )}

            <div className="mt-8 rounded-2xl border border-dashed border-neutral-300 bg-white/60 p-5">
              <h3 className="text-sm font-semibold text-neutral-800">Live preview</h3>
              <p className="mt-1 text-xs text-neutral-500">
                Uses your form settings (not the last generated code snapshot). Click the{' '}
                <span className="font-medium text-neutral-700">round chat button</span> to open the panel — same flow as the real widget
                (no API calls).
              </p>
              <div
                className="relative mt-4 h-72 overflow-hidden rounded-xl border border-neutral-200 bg-[linear-gradient(180deg,#f4f4f5_0%,#e4e4e7_100%)]"
                style={{ contain: 'layout' }}
              >
                <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_1px_1px,rgba(0,0,0,0.06)_1px,transparent_0)] [background-size:20px_20px]" />
                <p className="pointer-events-none absolute left-3 top-3 max-w-[55%] text-[11px] leading-snug text-neutral-500">
                  Sample webpage — widget sits in the corner you selected ({position === 'bottom-left' ? 'bottom-left' : 'bottom-right'}).
                </p>

                {!previewOpen && (
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(true)}
                    className={`absolute bottom-4 z-10 flex h-14 w-14 items-center justify-center rounded-full shadow-lg ring-2 ring-white/80 transition hover:scale-105 active:scale-95 ${previewCorner}`}
                    style={{ backgroundColor: themeColor }}
                    aria-label={`Open ${chatbotName} preview`}
                    title="Open chat"
                  >
                    {logoUrl ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element -- preview: arbitrary URLs / data URLs */}
                        <img src={logoUrl} alt="" className="h-9 w-9 rounded-full bg-white object-cover" />
                      </>
                    ) : (
                      <span className="text-lg font-bold text-white">?</span>
                    )}
                  </button>
                )}

                {previewOpen && (
                  <div
                    className={`absolute bottom-4 z-10 flex w-[min(260px,calc(100%-2rem))] max-h-[min(260px,calc(100%-2rem))] flex-col overflow-hidden rounded-2xl border border-neutral-200/90 bg-white shadow-2xl ${previewCorner}`}
                    role="dialog"
                    aria-label={`${chatbotName} preview`}
                  >
                    <div
                      className="flex shrink-0 items-center justify-between gap-2 px-3 py-2.5 text-white"
                      style={{ backgroundColor: themeColor }}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {logoUrl ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element -- preview: arbitrary URLs / data URLs */}
                            <img src={logoUrl} alt="" className="h-8 w-8 shrink-0 rounded-full bg-white object-cover" />
                          </>
                        ) : (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20 text-[10px] font-bold">
                            AI
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold">{chatbotName}</div>
                          <div className="text-[10px] text-white/90">Online</div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          className="rounded-lg p-1.5 hover:bg-white/15"
                          aria-label="Minimize preview"
                          title="Minimize"
                          onClick={() => setPreviewOpen(false)}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M6 12h12" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="rounded-lg p-1.5 hover:bg-white/15"
                          aria-label="Close preview"
                          title="Close"
                          onClick={() => setPreviewOpen(false)}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2.5">
                      <p className="text-[11px] leading-relaxed text-neutral-700">{welcomeMessage}</p>
                      <div className="flex flex-col gap-1.5">
                        {previewStarters.slice(0, 4).map((q) => (
                          <button
                            key={q}
                            type="button"
                            disabled
                            className="cursor-default rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-left text-[10px] text-neutral-800"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                      <p className="pt-1 text-[10px] text-neutral-400">Messages disabled in preview.</p>
                    </div>
                    <div className="shrink-0 border-t border-neutral-100 px-2 py-2">
                      <div className="flex gap-1.5 rounded-lg bg-neutral-50 px-2 py-1.5 ring-1 ring-neutral-200/80">
                        <div className="flex-1 truncate text-[10px] text-neutral-400">Type a message…</div>
                        <span className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium text-white/90" style={{ backgroundColor: themeColor }}>
                          Send
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
