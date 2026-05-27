/**
 * Builds copy-paste React widget code for Next.js and Vite (TypeScript or JavaScript).
 */

function escapeTemplateLiteral(s) {
  if (s == null) return '';
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

function escapeJsSingleQuoted(s) {
  if (s == null) return '';
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function parseStarterQuestions(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export function normalizeConfig(form) {
  const envOrigin =
    (typeof process !== 'undefined' && (process.env.NEXT_PUBLIC_APP_ORIGIN || '').replace(/\/$/, '')) || '';
  const browserOrigin =
    (typeof window !== 'undefined' && window.location?.origin ? window.location.origin.replace(/\/$/, '') : '') || '';
  return {
    chatbotName: form.chatbotName?.trim() || 'Assistant',
    logoUrl: form.logoUrl?.trim() || '',
    agentId: form.agentId?.trim() || 'default-agent',
    starterQuestions: Array.isArray(form.starterQuestions)
      ? form.starterQuestions.filter(Boolean)
      : parseStarterQuestions(form.starterQuestionsRaw || ''),
    themeColor: form.themeColor?.trim() || '#2563eb',
    welcomeMessage: form.welcomeMessage?.trim() || 'How can we help you today?',
    position: form.position === 'bottom-left' ? 'bottom-left' : 'bottom-right',
    apiBaseUrl:
      (form.apiBaseUrl || '').replace(/\/$/, '') ||
      envOrigin ||
      browserOrigin ||
      'http://13.200.189.83',
  };
}

/**
 * @param {ReturnType<typeof normalizeConfig>} c
 * @param {{ framework: 'next'|'vite', typescript: boolean }} opts
 */
export function generateChatWidgetCodeString(c, opts) {
  const config = normalizeConfig(c);
  const { framework, typescript } = opts;

  const startersLiteral = JSON.stringify(config.starterQuestions);
  const theme = escapeTemplateLiteral(config.themeColor);
  const name = escapeTemplateLiteral(config.chatbotName);
  const welcome = escapeTemplateLiteral(config.welcomeMessage);
  const logo = escapeTemplateLiteral(config.logoUrl);
  const defaultPos = config.position;

  const envComment =
    framework === 'next'
      ? '// Optional: NEXT_PUBLIC_WIDGET_CHAT_API_URL in .env.local (origin only, no trailing slash)'
      : '// Optional: VITE_WIDGET_CHAT_API_URL in .env';

  const baseLine =
    framework === 'next'
      ? `const resolvedBase = (apiBaseUrl ?? process.env.NEXT_PUBLIC_WIDGET_CHAT_API_URL ?? '').replace(/\\/$/, '');`
      : `const resolvedBase = (apiBaseUrl ?? import.meta.env.VITE_WIDGET_CHAT_API_URL ?? '').replace(/\\/$/, '');`;

  const reactImport =
    framework === 'vite'
      ? "import React, { useState, useCallback, useRef, useEffect } from 'react';\n"
      : "import { useState, useCallback, useRef, useEffect } from 'react';\n";

  const agentIdLiteral = JSON.stringify(config.agentId);

  const propsBlockTs = `export type ChatWidgetProps = {
  /** Origin that serves POST /api/widget/chat (no trailing slash). */
  apiBaseUrl?: string;
  chatbotName?: string;
  logoUrl?: string;
  themeColor?: string;
  welcomeMessage?: string;
  starterQuestions?: string[];
  position?: 'bottom-right' | 'bottom-left';
};

`;

  const propsBlockJs = `/**
 * @typedef {Object} ChatWidgetProps
 * @property {string} [apiBaseUrl]
 * @property {string} [chatbotName]
 * @property {string} [logoUrl]
 * @property {string} [themeColor]
 * @property {string} [welcomeMessage]
 * @property {string[]} [starterQuestions]
 * @property {'bottom-right'|'bottom-left'} [position]
 */

`;

  const destructureTs = `{
  apiBaseUrl,
  chatbotName = \`${name}\`,
  logoUrl = \`${logo}\`,
  themeColor = \`${theme}\`,
  welcomeMessage = \`${welcome}\`,
  starterQuestions = ${startersLiteral},
  position = '${defaultPos}',
}: ChatWidgetProps`;

  const destructureJs = `{
  apiBaseUrl,
  chatbotName = \`${name}\`,
  logoUrl = \`${logo}\`,
  themeColor = \`${theme}\`,
  welcomeMessage = \`${welcome}\`,
  starterQuestions = ${startersLiteral},
  position = '${defaultPos}',
}`;

  const typeMessageLine = typescript ? "type ChatMessage = { id: number; role: 'user' | 'assistant'; content: string };\n\n" : '';

  const useStateMessages = typescript ? 'useState<ChatMessage[]>([])' : 'useState([])';
  const useRefEnd = typescript ? 'useRef<HTMLDivElement | null>(null)' : 'useRef(null)';
  const sendParam = typescript ? '(text: string)' : '(text)';
  const starterParam = typescript ? '(q: string)' : '(q)';
  const userMsgLine = typescript ? 'const userMsg: ChatMessage = {' : 'const userMsg = {';

  const propsExport = typescript ? propsBlockTs : propsBlockJs;
  const destructure = typescript ? destructureTs : destructureJs;
  const fnComment = typescript ? '' : '/** @param {ChatWidgetProps} props */\n';

  const clientDirective =
    framework === 'next' ? `'use client';

` : '';

  const code = `${clientDirective}${reactImport}${propsExport}${fnComment}${envComment}

const WIDGET_AGENT_ID = ${agentIdLiteral};

${typeMessageLine}export default function ChatWidget(${destructure}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = ${useStateMessages};
  const endRef = ${useRefEnd};

  const fabPositionClass = position === 'bottom-left' ? 'left-4 sm:left-6' : 'right-4 sm:right-6';
  const panelPositionClass = position === 'bottom-left' ? 'left-4 sm:left-6' : 'right-4 sm:right-6';

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  const send = useCallback(
    async ${sendParam} => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;
      ${baseLine}
      if (!resolvedBase) {
        console.error('ChatWidget: pass apiBaseUrl or set the WIDGET_CHAT_API env.');
        return;
      }
      setLoading(true);
      ${userMsgLine} id: Date.now(), role: 'user', content: trimmed };
      setMessages((m) => [...m, userMsg]);
      setInput('');

      try {
        const res = await fetch(\`\${resolvedBase}/api/widget/chat\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: WIDGET_AGENT_ID, message: trimmed }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        const reply = typeof data?.reply === 'string' ? data.reply : JSON.stringify(data ?? {});
        setMessages((m) => [...m, { id: Date.now() + 1, role: 'assistant', content: reply }]);
      } catch {
        setMessages((m) => [
          ...m,
          {
            id: Date.now() + 1,
            role: 'assistant',
            content: 'Sorry, something went wrong. Please try again.',
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading]
  );

  const onStarter = ${starterParam} => {
    void send(q);
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999]">
      {!open && (
        <button
          type="button"
          aria-label={\`Open \${chatbotName}\`}
          onClick={() => setOpen(true)}
          className={\`pointer-events-auto fixed bottom-4 sm:bottom-6 \${fabPositionClass} flex h-14 w-14 items-center justify-center rounded-full shadow-lg ring-1 ring-black/10 transition hover:scale-105 active:scale-95\`}
          style={{ backgroundColor: themeColor }}
        >
          {logoUrl ? (
            <img src={logoUrl} alt="" className="h-9 w-9 rounded-full bg-white object-cover" />
          ) : (
            <span className="text-xl font-semibold text-white">?</span>
          )}
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label={chatbotName}
          className={\`pointer-events-auto fixed bottom-4 sm:bottom-6 \${panelPositionClass} flex max-h-[min(72vh,520px)] w-[min(100vw-2rem,380px)] flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl\`}
        >
          <div
            className="flex items-center justify-between gap-2 px-4 py-3 text-white"
            style={{ backgroundColor: themeColor }}
          >
            <div className="flex min-w-0 items-center gap-2">
              {logoUrl ? (
                <img src={logoUrl} alt="" className="h-9 w-9 shrink-0 rounded-full bg-white object-cover" />
              ) : (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-sm font-bold">
                  AI
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{chatbotName}</div>
                <div className="text-xs text-white/90">Online</div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="rounded-lg p-2 hover:bg-white/15"
                aria-label="Minimize"
                onClick={() => setOpen(false)}
                title="Minimize"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 12h12" />
                </svg>
              </button>
              <button
                type="button"
                className="rounded-lg p-2 hover:bg-white/15"
                aria-label="Close"
                onClick={() => setOpen(false)}
                title="Close"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-neutral-700">{welcomeMessage}</p>
                {starterQuestions.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {starterQuestions.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => onStarter(q)}
                        className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-left text-sm text-neutral-800 transition hover:bg-neutral-100"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={\`flex \${m.role === 'user' ? 'justify-end' : 'justify-start'}\`}>
                <div
                  className={\`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed \${
                    m.role === 'user' ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-900'
                  }\`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-neutral-100 px-3 py-2 text-sm text-neutral-500">Thinking…</div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t border-neutral-100 p-3">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                placeholder="Type a message…"
                className="min-w-0 flex-1 rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-300"
              />
              <button
                type="button"
                disabled={loading}
                onClick={() => void send(input)}
                className="shrink-0 rounded-xl px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: themeColor }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
`;

  return code;
}

/**
 * Structured steps for the Install & placement UI (kept in sync with generateInstructions).
 * @returns {{ step: number, title: string, body: string, snippets?: { label: string, code: string }[] }[]}
 */
export function getInstallSteps(config, { framework, typescript }) {
  const c = normalizeConfig(config);
  const file = typescript ? 'ChatWidget.tsx' : 'ChatWidget.jsx';
  const envKey = framework === 'next' ? 'NEXT_PUBLIC_WIDGET_CHAT_API_URL' : 'VITE_WIDGET_CHAT_API_URL';
  const importPath =
    framework === 'next'
      ? `@/components/${file.replace(/\.(tsx|jsx)$/, '')}`
      : `./components/${file.replace(/\.(tsx|jsx)$/, '')}`;

  if (framework === 'next') {
    return [
      {
        step: 1,
        title: 'Prerequisites',
        body: 'Use React, Tailwind CSS, and the Next.js App Router. The generated file is a Client Component (`use client` is already at the top).',
      },
      {
        step: 2,
        title: 'Create the widget file',
        body: `Add a new file at \`components/${file}\` (or \`src/components/${file}\` if you use a \`src\` folder). Paste the full contents from the Component code tab after you generate. The agent is already set inside the file as \`WIDGET_AGENT_ID\`—regenerate after picking a different agent if needed.`,
      },
      {
        step: 3,
        title: 'Optional: default API origin',
        body: 'If you omit the `apiBaseUrl` prop, the widget reads this public env var at build time.',
        snippets: [{ label: '.env.local', code: `${envKey}=${c.apiBaseUrl}` }],
      },
      {
        step: 4,
        title: 'Mount in App Router',
        body: 'Import the widget in `app/layout.tsx` for every page, or in a specific `app/.../page.tsx` route only.',
        snippets: [
          {
            label: 'app/layout.tsx (inside <body>)',
            code: `import ChatWidget from '${importPath}';\n\n<ChatWidget apiBaseUrl={process.env.${envKey}} />`,
          },
        ],
      },
    ];
  }

  return [
    {
      step: 1,
      title: 'Prerequisites',
      body: 'Use React, Tailwind CSS, and Vite. No `use client` directive is required.',
    },
      {
        step: 2,
        title: 'Create the widget file',
        body: `Save the generated code as \`src/components/${file}\` (adjust the path if your Vite \`src\` layout differs). The agent id is embedded as \`WIDGET_AGENT_ID\` in that file.`,
      },
    {
      step: 3,
      title: 'Optional: default API origin',
      body: 'Vite exposes only env vars prefixed with `VITE_` to the client.',
      snippets: [{ label: '.env', code: `${envKey}=${c.apiBaseUrl}` }],
    },
    {
      step: 4,
      title: 'Mount in your app root',
      body: 'Import once in `App.tsx` / `App.jsx` so the bubble appears on all views, or only inside a layout route if you prefer.',
      snippets: [
        {
          label: 'src/App.tsx',
          code: `import ChatWidget from '${importPath}';\n\nexport default function App() {\n  return (\n    <>\n      {/* your routes */}\n      <ChatWidget apiBaseUrl={import.meta.env.${envKey}} />\n    </>\n  );\n}`,
        },
      ],
    },
  ];
}

export function generateInstructions(config, { framework, typescript }) {
  const c = normalizeConfig(config);
  const file = typescript ? 'ChatWidget.tsx' : 'ChatWidget.jsx';
  const envKey = framework === 'next' ? 'NEXT_PUBLIC_WIDGET_CHAT_API_URL' : 'VITE_WIDGET_CHAT_API_URL';
  const importPath = framework === 'next' ? `@/components/${file.replace(/\.(tsx|jsx)$/, '')}` : `./components/${file.replace(/\.(tsx|jsx)$/, '')}`;

  if (framework === 'next') {
    return [
      `# Install`,
      ``,
      `Use React, Tailwind CSS, and the App Router. Copy the generated file to \`components/${file}\`.`,
      ``,
      `# Environment (optional)`,
      ``,
      `In \`.env.local\`:`,
      ``,
      `\`\`\`env`,
      `${envKey}=${c.apiBaseUrl}`,
      `\`\`\``,
      ``,
      `# Import in \`app/layout.tsx\` or \`app/page.tsx\``,
      ``,
      `No \`agentId\` prop is required—the generated file defines \`WIDGET_AGENT_ID\` for you.`,
      ``,
      `\`\`\`tsx`,
      `import ChatWidget from '${importPath}';`,
      ``,
      `<ChatWidget apiBaseUrl={process.env.${envKey}} />`,
      `\`\`\``,
    ].join('\n');
  }

  return [
    `# Install`,
    ``,
    `Copy the generated file to \`src/components/${file}\`.`,
    ``,
    `# Environment (optional)`,
    ``,
    `\`\`\`env`,
    `${envKey}=${c.apiBaseUrl}`,
    `\`\`\``,
    ``,
    `# Import in \`src/App.tsx\``,
    ``,
    `Agent id is embedded in the component as \`WIDGET_AGENT_ID\`; mount with only \`apiBaseUrl\` (optional if env is set).`,
    ``,
    `\`\`\`tsx`,
    `import ChatWidget from '${importPath}';`,
    ``,
    `<ChatWidget apiBaseUrl={import.meta.env.${envKey}} />`,
    `\`\`\``,
  ].join('\n');
}

export function generateEmbedScriptTag(config, scriptOrigin) {
  const c = normalizeConfig(config);
  const origin = (scriptOrigin || 'https://elevatetrust.in').replace(/\/$/, '');
  const starters = c.starterQuestions.join('|');
  return [
    `<script`,
    `  src="${origin}/widget.js"`,
    `  data-agent-id="${escapeJsSingleQuoted(c.agentId)}"`,
    `  data-chatbot-name="${escapeJsSingleQuoted(c.chatbotName)}"`,
    `  data-logo="${escapeJsSingleQuoted(c.logoUrl)}"`,
    `  data-theme="${escapeJsSingleQuoted(c.themeColor)}"`,
    `  data-welcome="${escapeJsSingleQuoted(c.welcomeMessage)}"`,
    `  data-position="${c.position}"`,
    `  data-api-base="${escapeJsSingleQuoted(c.apiBaseUrl)}"`,
    `  data-starters="${escapeJsSingleQuoted(starters)}"`,
    `></script>`,
  ].join('\n');
}

export function generateEmbedScriptExplainer() {
  return [
    'Host `widget.js` on your CDN or site. The script reads `data-*` attributes, mounts a small UI, and POSTs to `${dataApiBase}/api/widget/chat` (default origin is the script host if `data-api-base` is omitted) with body `{ agentId, message, sessionId? }`.',
    ``,
    `- **HTML:** paste before \`</body>\`.`,
    `- **WordPress:** Custom HTML widget in the footer or a hooks plugin.`,
    `- **SPAs:** inject once; avoid duplicate tags on navigation.`,
    ``,
    `Enable CORS on your API for browser origins that embed the widget.`,
  ].join('\n');
}
