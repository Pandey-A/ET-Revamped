/**
 * ElevateTrust embeddable chat widget (vanilla JS).
 * Usage:
 *   <script src="https://YOUR_APP_ORIGIN/widget.js"
 *     data-agent-id="agent_..."
 *     data-chatbot-name="Support"
 *     data-theme="#2563eb"
 *     data-logo="https://..."
 *     data-welcome="Hi!"
 *     data-starters="Q1|Q2"
 *     data-position="bottom-right"
 *     data-api-base="https://YOUR_APP_ORIGIN"  (optional; defaults to script host)
 *   ></script>
 */
(function () {
  var sc = document.currentScript;
  if (!sc || !sc.getAttribute) {
    console.error('[ET Widget] Could not read script tag');
    return;
  }

  var agentId = (sc.getAttribute('data-agent-id') || '').trim();
  if (!agentId) {
    console.error('[ET Widget] Missing data-agent-id');
    return;
  }

  var apiBase = (sc.getAttribute('data-api-base') || '').trim();
  if (!apiBase) {
    try {
      apiBase = new URL(sc.src).origin;
    } catch (e) {
      console.error('[ET Widget] Invalid script src / could not resolve API origin');
      return;
    }
  }
  apiBase = apiBase.replace(/\/$/, '');

  var chatbotName = sc.getAttribute('data-chatbot-name') || 'Assistant';
  var logo = sc.getAttribute('data-logo') || '';
  var theme = sc.getAttribute('data-theme') || '#2563eb';
  var welcome = sc.getAttribute('data-welcome') || 'How can we help?';
  var position = sc.getAttribute('data-position') === 'bottom-left' ? 'bottom-left' : 'bottom-right';
  var startersRaw = sc.getAttribute('data-starters') || '';
  var starters = startersRaw
    ? startersRaw.split('|').map(function (s) {
        return s.trim();
      }).filter(Boolean)
    : [];

  var sidKey = 'et_widget_session_' + agentId;
  function getSessionId() {
    try {
      var x = localStorage.getItem(sidKey);
      if (x) return x;
    } catch (e) {}
    var id = 'w_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    try {
      localStorage.setItem(sidKey, id);
    } catch (e2) {}
    return id;
  }

  var corner = position === 'bottom-left' ? 'left:16px;' : 'right:16px;';
  var z = 2147483000;

  var root = document.createElement('div');
  root.setAttribute('data-et-widget', '1');
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:' + z + ';font-family:system-ui,-apple-system,sans-serif;';

  var fab = document.createElement('button');
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Open chat');
  fab.style.cssText =
    'pointer-events:auto;position:fixed;bottom:20px;' +
    corner +
    'width:56px;height:56px;border-radius:9999px;border:none;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;background:' +
    theme +
    ';';

  if (logo) {
    var img = document.createElement('img');
    img.src = logo;
    img.alt = '';
    img.style.cssText = 'width:36px;height:36px;border-radius:9999px;object-fit:cover;background:#fff;';
    fab.appendChild(img);
  } else {
    fab.innerHTML = '<span style="font-size:18px;font-weight:700;color:#fff">?</span>';
  }

  var panel = document.createElement('div');
  panel.setAttribute('role', 'dialog');
  panel.style.cssText =
    'pointer-events:auto;display:none;flex-direction:column;position:fixed;bottom:20px;' +
    corner +
    'width:min(100vw - 32px, 380px);max-height:min(72vh, 520px);height:min(72vh, 520px);background:#fff;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.18);border:1px solid rgba(0,0,0,.08);overflow:hidden;';

  var header = document.createElement('div');
  header.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;padding:10px 12px;color:#fff;background:' +
    theme +
    ';';

  var headLeft = document.createElement('div');
  headLeft.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0;';
  if (logo) {
    var av = document.createElement('img');
    av.src = logo;
    av.alt = '';
    av.style.cssText = 'width:36px;height:36px;border-radius:9999px;object-fit:cover;background:#fff;flex-shrink:0;';
    headLeft.appendChild(av);
  } else {
    headLeft.innerHTML =
      '<div style="width:36px;height:36px;border-radius:9999px;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">AI</div>';
  }
  var titles = document.createElement('div');
  titles.style.cssText = 'min-width:0;';
  titles.innerHTML =
    '<div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
    escapeHtml(chatbotName) +
    '</div><div style="font-size:11px;opacity:.9">Online</div>';
  headLeft.appendChild(titles);

  var headBtns = document.createElement('div');
  headBtns.style.cssText = 'display:flex;gap:2px;flex-shrink:0;';
  function btn(label, svgPath) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.style.cssText =
      'background:transparent;border:none;color:#fff;cursor:pointer;padding:6px;border-radius:8px;line-height:0;';
    b.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="' +
      svgPath +
      '"/></svg>';
    return b;
  }
  var minBtn = btn('Minimize', 'M6 12h12');
  var closeBtn = btn('Close', 'M6 6l12 12M18 6L6 18');
  function closePanel() {
    panel.style.display = 'none';
    fab.style.display = 'flex';
  }
  minBtn.onclick = closePanel;
  closeBtn.onclick = closePanel;
  headBtns.appendChild(minBtn);
  headBtns.appendChild(closeBtn);
  header.appendChild(headLeft);
  header.appendChild(headBtns);

  var body = document.createElement('div');
  body.style.cssText =
    'flex:1;min-height:0;overflow-y:auto;padding:12px;font-size:13px;color:#404040;display:flex;flex-direction:column;';

  var msgs = document.createElement('div');
  msgs.style.cssText = 'display:flex;flex-direction:column;gap:8px;flex:1;min-height:0;';

  var inputRow = document.createElement('div');
  inputRow.style.cssText =
    'display:flex;gap:8px;padding:10px 12px;border-top:1px solid #eee;flex-shrink:0;align-items:center;';
  var inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = 'Type a message…';
  inp.style.cssText =
    'flex:1;min-width:0;border:1px solid #e5e5e5;border-radius:10px;padding:8px 10px;font-size:13px;outline:none;';
  var send = document.createElement('button');
  send.type = 'button';
  send.textContent = 'Send';
  send.style.cssText =
    'flex-shrink:0;border:none;border-radius:10px;padding:8px 14px;font-size:13px;font-weight:600;color:#fff;cursor:pointer;background:' +
    theme +
    ';';
  inputRow.appendChild(inp);
  inputRow.appendChild(send);

  panel.appendChild(header);
  body.appendChild(msgs);
  panel.appendChild(body);
  panel.appendChild(inputRow);

  root.appendChild(fab);
  root.appendChild(panel);
  document.body.appendChild(root);

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function addBubble(text, role) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;justify-content:' + (role === 'user' ? 'flex-end' : 'flex-start') + ';';
    var b = document.createElement('div');
    b.style.cssText =
      'max-width:85%;padding:8px 10px;border-radius:14px;font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;' +
      (role === 'user' ? 'background:#171717;color:#fff;' : 'background:#f4f4f5;color:#171717;');
    b.textContent = text;
    wrap.appendChild(b);
    msgs.appendChild(wrap);
    body.scrollTop = body.scrollHeight;
  }

  function renderEmpty() {
    msgs.innerHTML = '';
    var w = document.createElement('p');
    w.style.margin = '0 0 8px 0';
    w.textContent = welcome;
    msgs.appendChild(w);
    starters.forEach(function (q) {
      var bt = document.createElement('button');
      bt.type = 'button';
      bt.textContent = q;
      bt.style.cssText =
        'display:block;width:100%;text-align:left;padding:8px 10px;margin-bottom:6px;border:1px solid #e5e5e5;border-radius:10px;background:#fafafa;cursor:pointer;font-size:13px;color:#262626;';
      bt.onclick = function () {
        inp.value = q;
        doSend();
      };
      msgs.appendChild(bt);
    });
  }

  var loading = false;
  function setLoading(on) {
    loading = on;
    send.disabled = on;
    inp.disabled = on;
  }

  function doSend() {
    var text = (inp.value || '').trim();
    if (!text || loading) return;
    inp.value = '';
    addBubble(text, 'user');
    setLoading(true);
    var think = document.createElement('div');
    think.id = 'et-widget-thinking';
    think.style.cssText = 'font-size:12px;color:#737373;padding:4px 0;';
    think.textContent = 'Thinking…';
    msgs.appendChild(think);
    body.scrollTop = body.scrollHeight;

    fetch(apiBase + '/api/widget/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: agentId,
        message: text,
        sessionId: getSessionId(),
      }),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          return { ok: r.ok, j: j };
        });
      })
      .then(function (_ref) {
        var t = document.getElementById('et-widget-thinking');
        if (t) t.remove();
        var reply = _ref.j && typeof _ref.j.reply === 'string' ? _ref.j.reply : null;
        if (!_ref.ok || !reply) {
          var err = (_ref.j && _ref.j.error) || 'Request failed';
          addBubble(String(err), 'assistant');
          return;
        }
        addBubble(reply, 'assistant');
      })
      .catch(function () {
        var t2 = document.getElementById('et-widget-thinking');
        if (t2) t2.remove();
        addBubble('Network error. Please try again.', 'assistant');
      })
      .finally(function () {
        setLoading(false);
      });
  }

  send.onclick = doSend;
  inp.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });

  fab.onclick = function () {
    fab.style.display = 'none';
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    if (!msgs.dataset.seeded) {
      msgs.dataset.seeded = '1';
      renderEmpty();
    }
    inp.focus();
  };
})();
