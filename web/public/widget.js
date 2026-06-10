/**
 * Chattiq embeddable website widget.
 * Tracks sessions on the admin dashboard; sends WhatsApp summary after ~1.5–2 min inactivity.
 *
 * <script src="https://YOUR_APP/widget.js"
 *   data-agent-id="agent_..."
 *   data-chatbot-name="Support"
 *   data-theme="#1B5E20"
 *   data-inactivity-ms="90000"
 *   data-api-base="https://YOUR_APP"
 * ></script>
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

  var scriptOrigin = '';
  try {
    scriptOrigin = new URL(sc.src).origin;
  } catch (e) {
    scriptOrigin = '';
  }

  var apiBase = (sc.getAttribute('data-api-base') || '').trim();
  if (!apiBase) {
    if (scriptOrigin) {
      apiBase = scriptOrigin;
    } else if (window && window.location && window.location.origin) {
      apiBase = window.location.origin;
    } else {
      console.error('[ET Widget] Missing data-api-base and invalid script src');
      return;
    }
  }
  apiBase = apiBase.replace(/\/$/, '');

  var chatbotName = sc.getAttribute('data-chatbot-name') || 'Assistant';
  var logo = (sc.getAttribute('data-logo') || '').trim();
  if (!logo) logo = apiBase + '/chatops-icon.png';
  var theme = sc.getAttribute('data-theme') || '#1B5E20';
  var welcome = sc.getAttribute('data-welcome') || 'Hi! How can we help you today?';
  var position = sc.getAttribute('data-position') === 'bottom-left' ? 'bottom-left' : 'bottom-right';
  var startersRaw = sc.getAttribute('data-starters') || '';
  var inactivityMs = parseInt(sc.getAttribute('data-inactivity-ms') || '90000', 10);
  if (inactivityMs < 60000) inactivityMs = 90000;
  if (inactivityMs > 120000) inactivityMs = 120000;
  var leadAfterMsgs = parseInt(sc.getAttribute('data-lead-after-msgs') || '2', 10);
  if (leadAfterMsgs < 1) leadAfterMsgs = 2;
  var leadAfterMs = parseInt(sc.getAttribute('data-lead-after-ms') || '90000', 10);
  if (leadAfterMs < 30000) leadAfterMs = 90000;

  var starters = startersRaw
    ? startersRaw.split('|').map(function (s) { return s.trim(); }).filter(Boolean)
    : [];

  var sidKey = 'et_widget_session_' + agentId;
  var completedKey = 'et_widget_done_' + agentId;

  function getSessionId() {
    try {
      if (localStorage.getItem(completedKey) === '1') {
        localStorage.removeItem(sidKey);
        localStorage.removeItem(completedKey);
      }
      var x = localStorage.getItem(sidKey);
      if (x) return x;
    } catch (e) {}
    var id = 'widget_' + agentId + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    try {
      localStorage.setItem(sidKey, id);
    } catch (e2) {}
    return id;
  }

  var sessionId = getSessionId();
  var userMsgCount = 0;
  var chatCompleted = false;
  var inactivityTimer = null;
  var contact = { name: '', email: '', phone: '' };
  var showContactForm = false;
  var leadAsked = false;
  var leadTimerId = null;

  function resetInactivityTimer() {
    if (chatCompleted) return;
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(completeChat, inactivityMs);
  }

  function fetchJson(base, path, body) {
    return fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); });
  }

  function apiPost(path, body) {
    return fetchJson(apiBase, path, body).catch(function (err) {
      var fallback = (window && window.location && window.location.origin) ? window.location.origin : scriptOrigin;
      if (!fallback) throw err;
      fallback = fallback.replace(/\/$/, '');
      if (fallback === apiBase) throw err;
      console.warn('[ET Widget] Primary API base failed, retrying with page origin:', fallback);
      return fetchJson(fallback, path, body);
    });
  }

  function startSession() {
    apiPost('/api/widget/session', {
      agentId: agentId,
      sessionId: sessionId,
      origin: window.location.origin,
      pageUrl: window.location.href,
    }).catch(function () {});
  }

  function saveContact() {
    if (!contact.name && !contact.email && !contact.phone) return;
    apiPost('/api/widget/contact', {
      sessionId: sessionId,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
    }).catch(function () {});
  }

  function completeChat(reason) {
    if (chatCompleted) return;
    chatCompleted = true;
    if (inactivityTimer) clearTimeout(inactivityTimer);
    saveContact();
    apiPost('/api/widget/complete', { sessionId: sessionId, reason: reason || 'inactivity' })
      .then(function () {
        try {
          localStorage.setItem(completedKey, '1');
        } catch (e) {}
        addBubble('This chat has ended. Our team will follow up if you shared your details. Thank you!', 'assistant');
        inp.disabled = true;
        send.disabled = true;
      })
      .catch(function () {});
  }

  function tryParseContact(text) {
    var t = text.trim();
    var emailM = t.match(/[\w.+-]+@[\w.-]+\.\w+/);
    var phoneM = t.match(/\+?[\d\s()-]{8,}/);
    if (emailM) contact.email = emailM[0];
    if (phoneM) contact.phone = phoneM[0].trim();
    if (!contact.name && t.length < 60 && !emailM && !phoneM && t.split(' ').length <= 4) {
      contact.name = t;
    }
    if (contact.name || contact.email || contact.phone) saveContact();
  }

  function hasFullContact() {
    return !!(contact.name && contact.email && contact.phone);
  }

  function promptForLeadDetails() {
    if (leadAsked || chatCompleted || hasFullContact()) return;
    leadAsked = true;
    showContactForm = true;
    addBubble(
      'If you are interested in learning more about our services, please share your name, email, and phone number so we can connect with you.',
      'assistant'
    );
    contactForm.style.display = 'block';
    body.scrollTop = body.scrollHeight;
  }

  function scheduleLeadPromptByTime() {
    if (leadTimerId || leadAsked || chatCompleted) return;
    leadTimerId = setTimeout(function () {
      promptForLeadDetails();
    }, leadAfterMs);
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
    'pointer-events:auto;position:fixed;bottom:20px;' + corner +
    'width:56px;height:56px;border-radius:9999px;border:none;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;background:' + theme + ';';

  if (logo) {
    var img = document.createElement('img');
    img.src = logo;
    img.alt = '';
    img.style.cssText = 'width:36px;height:36px;border-radius:9999px;object-fit:cover;background:#fff;';
    fab.appendChild(img);
  } else {
    fab.innerHTML = '<span style="font-size:18px;font-weight:700;color:#fff">💬</span>';
  }

  var panel = document.createElement('div');
  panel.style.cssText =
    'pointer-events:auto;display:none;flex-direction:column;position:fixed;bottom:88px;' + corner +
    'width:min(100vw - 32px, 400px);max-height:min(78vh, 560px);height:min(78vh, 560px);background:#fff;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.18);border:1px solid rgba(0,0,0,.08);overflow:hidden;';

  var header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 14px;color:#fff;background:' + theme + ';';

  var headLeft = document.createElement('div');
  headLeft.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0;';
  headLeft.innerHTML =
    '<div style="width:36px;height:36px;border-radius:9999px;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">AI</div>' +
    '<div style="min-width:0"><div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(chatbotName) + '</div>' +
    '<div style="font-size:11px;opacity:.9">Online</div></div>';

  var closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.style.cssText = 'background:transparent;border:none;color:#fff;cursor:pointer;padding:6px;font-size:18px;';
  closeBtn.textContent = '×';
  closeBtn.onclick = function () {
    panel.style.display = 'none';
    fab.style.display = 'flex';
    if (userMsgCount > 0) completeChat('user_closed');
  };
  header.appendChild(headLeft);
  header.appendChild(closeBtn);

  var body = document.createElement('div');
  body.style.cssText = 'flex:1;min-height:0;overflow-y:auto;padding:12px;font-size:13px;color:#404040;display:flex;flex-direction:column;';

  var msgs = document.createElement('div');
  msgs.style.cssText = 'display:flex;flex-direction:column;gap:8px;flex:1;min-height:0;';

  var contactForm = document.createElement('div');
  contactForm.style.cssText = 'display:none;padding:10px;background:#f1f8f1;border-radius:12px;margin-top:8px;';
  contactForm.innerHTML =
    '<div data-et-lead-title style="font-weight:600;font-size:12px;margin-bottom:8px;color:#1B5E20">Your details so we can connect</div>' +
    '<div style="font-size:11px;color:#525252;margin-bottom:8px;line-height:1.4">Interested in our services? Leave your name, email, and phone.</div>';
  ['name', 'email', 'phone'].forEach(function (field) {
    var inpF = document.createElement('input');
    inpF.type = field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text';
    inpF.placeholder = field === 'name' ? 'Your name' : field === 'email' ? 'Email' : 'Phone';
    inpF.style.cssText = 'width:100%;margin-bottom:6px;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:12px;box-sizing:border-box;';
    inpF.dataset.field = field;
    inpF.oninput = function () {
      contact[field] = inpF.value.trim();
      saveContact();
    };
    contactForm.appendChild(inpF);
  });
  var contactSubmit = document.createElement('button');
  contactSubmit.type = 'button';
  contactSubmit.textContent = 'Submit details';
  contactSubmit.style.cssText = 'width:100%;padding:8px;border:none;border-radius:8px;background:' + theme + ';color:#fff;font-weight:600;cursor:pointer;font-size:12px;';
  contactSubmit.onclick = function () {
    saveContact();
    contactForm.style.display = 'none';
    showContactForm = false;
    addBubble('Thank you! We have your details and will connect with you soon. Feel free to ask anything else.', 'assistant');
  };
  contactForm.appendChild(contactSubmit);

  var inputRow = document.createElement('div');
  inputRow.style.cssText = 'display:flex;gap:8px;padding:10px 12px;border-top:1px solid #eee;flex-shrink:0;align-items:center;';
  var inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = 'Type a message…';
  inp.style.cssText = 'flex:1;min-width:0;border:1px solid #e5e5e5;border-radius:10px;padding:8px 10px;font-size:13px;outline:none;';
  var send = document.createElement('button');
  send.type = 'button';
  send.textContent = 'Send';
  send.style.cssText = 'flex-shrink:0;border:none;border-radius:10px;padding:8px 14px;font-size:13px;font-weight:600;color:#fff;cursor:pointer;background:' + theme + ';';
  inputRow.appendChild(inp);
  inputRow.appendChild(send);

  panel.appendChild(header);
  body.appendChild(msgs);
  body.appendChild(contactForm);
  panel.appendChild(body);
  panel.appendChild(inputRow);

  root.appendChild(fab);
  root.appendChild(panel);
  document.body.appendChild(root);

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function addBubble(text, role) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;justify-content:' + (role === 'user' ? 'flex-end' : 'flex-start') + ';';
    var b = document.createElement('div');
    b.style.cssText =
      'max-width:88%;padding:9px 12px;border-radius:14px;font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;' +
      (role === 'user' ? 'background:' + theme + ';color:#fff;' : 'background:#f4f4f5;color:#171717;');
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
    inp.disabled = on || chatCompleted;
  }

  function doSend() {
    var text = (inp.value || '').trim();
    if (!text || loading || chatCompleted) return;
    inp.value = '';
    addBubble(text, 'user');
    userMsgCount += 1;
    tryParseContact(text);
    resetInactivityTimer();

    setLoading(true);
    var think = document.createElement('div');
    think.id = 'et-widget-thinking';
    think.style.cssText = 'font-size:12px;color:#737373;padding:4px 0;';
    think.textContent = 'Thinking…';
    msgs.appendChild(think);
    body.scrollTop = body.scrollHeight;

    apiPost('/api/widget/chat', {
      agentId: agentId,
      message: text,
      sessionId: sessionId,
    })
      .then(function (ref) {
        var t = document.getElementById('et-widget-thinking');
        if (t) t.remove();
        var reply = ref.j && typeof ref.j.reply === 'string' ? ref.j.reply : null;
        if (ref.j && ref.j.sessionId) sessionId = ref.j.sessionId;
        if (!ref.ok || !reply) {
          addBubble((ref.j && ref.j.error) || 'Request failed', 'assistant');
          return;
        }
        addBubble(reply, 'assistant');
        resetInactivityTimer();
        if (userMsgCount >= leadAfterMsgs && !leadAsked && !hasFullContact()) {
          setTimeout(promptForLeadDetails, 2500);
        }
        var low = reply.toLowerCase();
        if (low.indexOf('mark this chat') >= 0 || low.indexOf('chat is complete') >= 0 || low.indexOf('chat complete') >= 0) {
          setTimeout(function () { completeChat('agent_closed'); }, 3000);
        }
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
      startSession();
      resetInactivityTimer();
      scheduleLeadPromptByTime();
    }
    inp.focus();
  };
})();
