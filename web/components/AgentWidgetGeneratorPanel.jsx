'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { getApiBaseUrl } from '@/lib/api';
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

const GEN_MIN_MS = 720;

const WIDGET_LIVE_ORIGIN = 'http://13.200.189.83';

const backendExample = `// Hosted gateway: app/api/widget/chat/route.js
// POST JSON { agentId, message, sessionId? } → { reply }`;

const backendExampleJs = `// Express example — same contract as /api/widget/chat
app.post('/api/widget/chat', express.json(), async (req, res) => {
  const { agentId, message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  res.json({ reply: '…' });
});
`;

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
      <pre className="max-h-40 overflow-auto p-3 text-xs leading-relaxed text-neutral-100">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Inline widget builder for one agent (agent hub page).
 */
export default function AgentWidgetGeneratorPanel({ agent }) {
  const [chatbotName, setChatbotName] = useState('Support Bot');
  const [logoUrl, setLogoUrl] = useState('');
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const [presetLoading, setPresetLoading] = useState(false);
  const [presetSaving, setPresetSaving] = useState(false);

  const agentId = agent?.id || '';

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
    if (!agent?.id) return;

    setChatbotName(agent.name?.trim() || 'Support Bot');
    setWelcomeMessage((agent.greeting_message || '').trim() || 'Hi! Ask us anything.');
    setLogoUrl('');
    setStarterRaw(defaultStarters);
    setThemeColor('#2563eb');
    setPosition('bottom-right');
    setFramework('next');
    setTypescript(true);
    const fromEnv = (process.env.NEXT_PUBLIC_APP_ORIGIN || '').replace(/\/$/, '');
    const origin = fromEnv || WIDGET_LIVE_ORIGIN;
    setApiBaseUrl(origin);
    setScriptOrigin(origin);
    setBundle(null);
    setTab('code');

    let cancelled = false;
    setPresetLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/agents/${encodeURIComponent(agent.id)}/widget-preset`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const c = data?.config;
        if (!c || typeof c !== 'object' || cancelled) return;
        if (typeof c.chatbotName === 'string') setChatbotName(c.chatbotName);
        if (typeof c.logoUrl === 'string') setLogoUrl(c.logoUrl);
        if (typeof c.starterQuestionsRaw === 'string') setStarterRaw(c.starterQuestionsRaw);
        if (typeof c.themeColor === 'string') setThemeColor(c.themeColor);
        if (typeof c.welcomeMessage === 'string') setWelcomeMessage(c.welcomeMessage);
        if (c.position === 'bottom-left' || c.position === 'bottom-right') setPosition(c.position);
        if (c.framework === 'next' || c.framework === 'vite') setFramework(c.framework);
        if (typeof c.typescript === 'boolean') setTypescript(c.typescript);
        if (typeof c.apiBaseUrl === 'string') setApiBaseUrl(c.apiBaseUrl);
        if (typeof c.scriptOrigin === 'string') setScriptOrigin(c.scriptOrigin);
      } catch {
        /* keep defaults */
      } finally {
        if (!cancelled) setPresetLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agent?.id, agent?.name, agent?.greeting_message]);

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
      toast.error(err.message || 'Could not upload logo');
    }
  }, [apiBaseUrl]);

  const handleGenerate = useCallback(async () => {
    if (!agentId) return;
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
        generatedLabel: new Date().toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      });
    } finally {
      setIsGenerating(false);
    }
  }, [
    agentId,
    chatbotName,
    logoUrl,
    starterRaw,
    themeColor,
    welcomeMessage,
    position,
    apiBaseUrl,
    framework,
    typescript,
    scriptOrigin,
  ]);

  const savePreset = useCallback(async () => {
    if (!agent?.id) return;
    setPresetSaving(true);
    try {
      const config = {
        v: 1,
        chatbotName,
        logoUrl,
        starterQuestionsRaw: starterRaw,
        themeColor,
        welcomeMessage,
        position,
        framework,
        typescript,
        apiBaseUrl,
        scriptOrigin,
      };
      const res = await apiFetch(`/agents/${encodeURIComponent(agent.id)}/widget-preset`, {
        method: 'PUT',
        body: JSON.stringify({ config }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Save failed');
      toast.success('Widget settings saved for this agent.');
    } catch (e) {
      toast.error(e.message || 'Could not save widget preset');
    } finally {
      setPresetSaving(false);
    }
  }, [
    agent?.id,
    chatbotName,
    logoUrl,
    starterRaw,
    themeColor,
    welcomeMessage,
    position,
    framework,
    typescript,
    apiBaseUrl,
    scriptOrigin,
  ]);

  const outputFilename = bundle ? (bundle.typescript ? 'ChatWidget.tsx' : 'ChatWidget.jsx') : 'ChatWidget.tsx';

  if (!agent?.id) return null;

  const rid = agent.id.replace(/[^a-zA-Z0-9_-]/g, '');

  return (
    <div className="aia-widget-panel-wrap rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
            <div className="aia-modal-header" style={{ marginBottom: 12 }}>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Embed widget</p>
                <h2 style={{ marginTop: 4, marginBottom: 0 }}>{agent.name || 'Agent'}</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="aia-btn aia-btn--secondary aia-btn--sm"
                  disabled={presetSaving || presetLoading}
                  onClick={() => void savePreset()}
                >
                  {presetSaving ? 'Saving…' : 'Save settings'}
                </button>
              </div>
            </div>

            {presetLoading && (
              <p className="text-xs text-neutral-500 mb-3">Loading saved widget settings…</p>
            )}

            <div className="grid gap-6 lg:grid-cols-12 text-neutral-900">
              <section className="lg:col-span-5">
                <div className="rounded-2xl border border-neutral-200/80 bg-neutral-50/80 p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2 mb-4">
                    <h3 className="text-base font-semibold">Configuration</h3>
                    {isDirty && (
                      <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-900 ring-1 ring-amber-200/80">
                        Regenerate to refresh tabs
                      </span>
                    )}
                  </div>
                  <div className="space-y-4 text-sm">
                    <label className="block font-medium text-neutral-700">
                      Chatbot name
                      <input
                        className="mt-1 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-300 bg-white"
                        value={chatbotName}
                        onChange={(e) => setChatbotName(e.target.value)}
                      />
                    </label>
                    <label className="block font-medium text-neutral-700">
                      Logo URL
                      <input
                        className="mt-1 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-300 bg-white"
                        value={logoUrl}
                        onChange={(e) => setLogoUrl(e.target.value)}
                        placeholder="https://…"
                      />
                    </label>
                    <label className="block font-medium text-neutral-700">
                      Upload logo
                      <input
                        type="file"
                        accept="image/*"
                        className="mt-1 block w-full text-xs text-neutral-600"
                        onChange={onLogoFile}
                      />
                    </label>

                    <label className="block font-medium text-neutral-700">
                      Starter questions (one per line)
                      <textarea
                        rows={3}
                        className="mt-1 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-300 bg-white"
                        value={starterRaw}
                        onChange={(e) => setStarterRaw(e.target.value)}
                      />
                    </label>
                    <label className="block font-medium text-neutral-700">
                      Theme color
                      <div className="mt-1 flex gap-2">
                        <input
                          type="color"
                          value={themeColor.length === 7 ? themeColor : '#2563eb'}
                          onChange={(e) => setThemeColor(e.target.value)}
                          className="h-9 w-12 cursor-pointer rounded border border-neutral-200 bg-white p-0.5"
                        />
                        <input
                          className="min-w-0 flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-sm bg-white"
                          value={themeColor}
                          onChange={(e) => setThemeColor(e.target.value)}
                        />
                      </div>
                    </label>
                    <label className="block font-medium text-neutral-700">
                      Welcome message
                      <input
                        className="mt-1 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-300 bg-white"
                        value={welcomeMessage}
                        onChange={(e) => setWelcomeMessage(e.target.value)}
                      />
                    </label>
                    <fieldset>
                      <legend className="font-medium text-neutral-700">Position</legend>
                      <div className="mt-1 flex gap-3 text-xs">
                        <label className="inline-flex items-center gap-1.5">
                          <input
                            type="radio"
                            name={`wpos-${rid}`}
                            checked={position === 'bottom-right'}
                            onChange={() => setPosition('bottom-right')}
                          />
                          Bottom right
                        </label>
                        <label className="inline-flex items-center gap-1.5">
                          <input
                            type="radio"
                            name={`wpos-${rid}`}
                            checked={position === 'bottom-left'}
                            onChange={() => setPosition('bottom-left')}
                          />
                          Bottom left
                        </label>
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend className="font-medium text-neutral-700">Framework</legend>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs">
                        <label className="inline-flex items-center gap-1.5">
                          <input type="radio" name={`wfw-${rid}`} checked={framework === 'next'} onChange={() => setFramework('next')} />
                          Next.js
                        </label>
                        <label className="inline-flex items-center gap-1.5">
                          <input type="radio" name={`wfw-${rid}`} checked={framework === 'vite'} onChange={() => setFramework('vite')} />
                          Vite
                        </label>
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend className="font-medium text-neutral-700">Language</legend>
                      <div className="mt-1 flex gap-3 text-xs">
                        <label className="inline-flex items-center gap-1.5">
                          <input type="radio" name={`wts-${rid}`} checked={typescript} onChange={() => setTypescript(true)} />
                          TypeScript
                        </label>
                        <label className="inline-flex items-center gap-1.5">
                          <input type="radio" name={`wts-${rid}`} checked={!typescript} onChange={() => setTypescript(false)} />
                          JavaScript
                        </label>
                      </div>
                    </fieldset>

                  </div>

                  <div className="mt-5 border-t border-neutral-200 pt-4">
                    <button
                      type="button"
                      onClick={() => void handleGenerate()}
                      disabled={isGenerating}
                      className="relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-b from-neutral-900 to-black px-3 py-3 text-sm font-semibold text-white shadow-md transition hover:opacity-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isGenerating ? 'Generating…' : 'Generate widget code'}
                    </button>
                    <p className="mt-2 text-center text-[10px] text-neutral-500">
                      Uses this agent&apos;s id in all snippets. Save settings keeps your form; generate refreshes code tabs.
                    </p>
                  </div>
                </div>
              </section>

              <section className="lg:col-span-7">
                <div className="mb-3 flex flex-wrap gap-1.5 border-b border-neutral-200 pb-3">
                  {[
                    { id: 'code', label: 'Component' },
                    { id: 'instructions', label: 'Install' },
                    { id: 'embed', label: 'Embed' },
                    { id: 'api', label: 'API note' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTab(t.id)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
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
                  <div className="mb-4 rounded-xl border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-xs text-neutral-600">
                    Press <strong>Generate widget code</strong> to fill this tab.
                  </div>
                )}

                {tab === 'code' && (
                  <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">{outputFilename}</h3>
                      <CopyButton text={bundle?.componentCode ?? ''} disabled={!bundle || isGenerating} />
                    </div>
                    <div className="relative min-h-[120px]">
                      {isGenerating && !bundle?.componentCode && <CodeSkeleton />}
                      {bundle?.componentCode && (
                        <pre className="max-h-[min(50vh,420px)] overflow-auto rounded-lg bg-neutral-950 p-3 text-[11px] leading-relaxed text-neutral-100">
                          <code>{bundle.componentCode}</code>
                        </pre>
                      )}
                    </div>
                  </div>
                )}

                {tab === 'instructions' && (
                  <div className="space-y-3">
                    {!bundle?.installSteps ? (
                      <div className="rounded-xl border border-neutral-200 bg-white p-6 text-center text-xs text-neutral-600">
                        Generate first.
                      </div>
                    ) : (
                      <ol className="space-y-3">
                        {bundle.installSteps.map((step) => (
                          <li key={step.step} className="rounded-xl border border-neutral-200 bg-white p-3 text-xs shadow-sm">
                            <div className="flex gap-2">
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-[11px] font-bold text-white">
                                {step.step}
                              </span>
                              <div className="min-w-0">
                                <h4 className="font-semibold text-neutral-900">{step.title}</h4>
                                <p className="mt-1 whitespace-pre-line text-neutral-600 leading-relaxed">{step.body}</p>
                                {step.snippets?.length > 0 && (
                                  <div className="mt-2 space-y-2">
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
                    )}
                  </div>
                )}

                {tab === 'embed' && (
                  <div className="space-y-3">
                    {!bundle?.embedTag ? (
                      <div className="rounded-xl border border-neutral-200 bg-white p-6 text-center text-xs text-neutral-600">
                        Generate first.
                      </div>
                    ) : (
                      <>
                        <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
                          <div className="mb-2 flex justify-between gap-2">
                            <h3 className="text-sm font-semibold">Script tag</h3>
                            <CopyButton text={bundle.embedTag} disabled={isGenerating} />
                          </div>
                          <pre className="max-h-48 overflow-auto rounded-lg bg-neutral-950 p-3 text-[11px] text-neutral-100">
                            <code>{bundle.embedTag}</code>
                          </pre>
                        </div>
                        <p className="text-xs text-neutral-600 whitespace-pre-line">{generateEmbedScriptExplainer()}</p>
                      </>
                    )}
                  </div>
                )}

                {tab === 'api' && (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
                      <div className="mb-2 flex justify-between gap-2">
                        <h3 className="text-sm font-semibold">Next route</h3>
                        <CopyButton text={backendExample} />
                      </div>
                      <pre className="max-h-36 overflow-auto rounded-lg bg-neutral-950 p-3 text-[11px] text-neutral-100">
                        <code>{backendExample}</code>
                      </pre>
                    </div>
                    <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
                      <div className="mb-2 flex justify-between gap-2">
                        <h3 className="text-sm font-semibold">Express</h3>
                        <CopyButton text={backendExampleJs} />
                      </div>
                      <pre className="max-h-36 overflow-auto rounded-lg bg-neutral-950 p-3 text-[11px] text-neutral-100">
                        <code>{backendExampleJs}</code>
                      </pre>
                    </div>
                  </div>
                )}

                <div className="mt-4 rounded-xl border border-dashed border-neutral-300 bg-neutral-50/50 p-3">
                  <h4 className="text-xs font-semibold text-neutral-800">Preview</h4>
                  <div
                    className="relative mt-2 h-48 overflow-hidden rounded-lg border border-neutral-200 bg-[linear-gradient(180deg,#f4f4f5_0%,#e4e4e7_100%)]"
                    style={{ contain: 'layout' }}
                  >
                    {!previewOpen && (
                      <button
                        type="button"
                        onClick={() => setPreviewOpen(true)}
                        className={`absolute bottom-3 z-10 flex h-11 w-11 items-center justify-center rounded-full shadow-lg ring-2 ring-white/80 ${previewCorner}`}
                        style={{ backgroundColor: themeColor }}
                        aria-label="Open preview"
                      >
                        {logoUrl ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={logoUrl} alt="" className="h-7 w-7 rounded-full bg-white object-cover" />
                          </>
                        ) : (
                          <span className="text-sm font-bold text-white">?</span>
                        )}
                      </button>
                    )}
                    {previewOpen && (
                      <div
                        className={`absolute bottom-3 z-10 flex w-[min(220px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl ${previewCorner}`}
                      >
                        <div className="flex items-center justify-between gap-2 px-2 py-2 text-white text-xs" style={{ backgroundColor: themeColor }}>
                          <span className="truncate font-semibold">{chatbotName}</span>
                          <button type="button" className="rounded p-1 hover:bg-white/15" onClick={() => setPreviewOpen(false)}>
                            ✕
                          </button>
                        </div>
                        <div className="space-y-1.5 overflow-y-auto px-2 py-2 text-[10px] text-neutral-700">
                          <p>{welcomeMessage}</p>
                          {previewStarters.slice(0, 3).map((q) => (
                            <div key={q} className="rounded border border-neutral-200 bg-neutral-50 px-2 py-1">
                              {q}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
    </div>
  );
}
