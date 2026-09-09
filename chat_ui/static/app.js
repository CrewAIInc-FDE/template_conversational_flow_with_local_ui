"use strict";

const els = {
  messages: document.getElementById("messages"),
  form: document.getElementById("composer-form"),
  input: document.getElementById("composer-input"),
  send: document.getElementById("send-btn"),
  newChat: document.getElementById("new-chat"),
  headerStatus: document.getElementById("header-status"),
  connStatus: document.getElementById("conn-status"),
};

const STORAGE_KEY = "research_chat_session_id";
let sessionId = null;
let sending = false;
let renderedCount = 0; // number of transcript messages already drawn

// ---------- helpers ----------

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// User text: escape + linkify bare URLs. Newlines are preserved via the
// `.plain` CSS class (white-space: pre-wrap).
function formatPlain(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1">$1</a>'
  );
  return html;
}

// Assistant text: render markdown (bold, lists, links, headings, code) then
// sanitize. Falls back to plain formatting if the libraries aren't available.
function formatMarkdown(text) {
  const source = text == null ? "" : String(text);
  if (window.marked && window.DOMPurify) {
    const rawHtml = window.marked.parse(source, {
      breaks: true,
      gfm: true,
    });
    return window.DOMPurify.sanitize(rawHtml, {
      ADD_ATTR: ["target", "rel"],
    });
  }
  return formatPlain(source);
}

// Make every link open safely in a new tab.
function hardenLinks(container) {
  container.querySelectorAll("a").forEach((a) => {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function scrollToBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

function setStatus(text, kind) {
  els.headerStatus.textContent = text;
  els.headerStatus.className = "chat-status" + (kind ? " " + kind : "");
}

function botAvatar() {
  return '<span class="avatar avatar-bot"><span class="mark-curve"></span></span>';
}

// ---------- rendering ----------

function showWelcome() {
  els.messages.innerHTML = `
    <div class="welcome">
      <div class="welcome-mark"><span class="mark-curve"></span></div>
      <h1>Welcome to the <span>Research</span> Assistant</h1>
      <p>
        I can only search the web for information. Ask me to look something up,
        and I'll find current answers online. I won't do other tasks.
      </p>
    </div>`;
}

function renderMessage(role, content, opts = {}) {
  const isBot = role !== "user";
  const wrap = document.createElement("div");
  wrap.className = "msg " + (isBot ? "bot" : "user");

  const avatar = isBot ? botAvatar() : '<span class="avatar avatar-user">You</span>';
  const name = isBot ? "Research Assistant" : "You";
  const nameClass = isBot ? "msg-name bot" : "msg-name";
  const badge = opts.badge
    ? `<span class="msg-badge">${escapeHtml(opts.badge)}</span>`
    : "";

  const textHtml = isBot ? formatMarkdown(content) : formatPlain(content);
  const textClass = isBot ? "msg-text markdown" : "msg-text plain";

  wrap.innerHTML = `
    ${avatar}
    <div class="msg-body">
      <div class="msg-head">
        <span class="${nameClass}">${name}</span>
        ${badge}
        <span class="msg-time">${opts.time || nowTime()}</span>
      </div>
      <div class="${textClass}">${textHtml}</div>
    </div>`;
  els.messages.appendChild(wrap);
  hardenLinks(wrap);
  return wrap;
}

function renderTranscript(messages) {
  els.messages.innerHTML = "";
  renderedCount = 0;
  if (!messages || messages.length === 0) {
    showWelcome();
    return;
  }
  for (const m of messages) {
    if (m.role === "system") continue;
    renderMessage(m.role, m.content);
    renderedCount += 1;
  }
  scrollToBottom();
}

function showTyping() {
  const wrap = document.createElement("div");
  wrap.className = "msg bot";
  wrap.id = "typing-indicator";
  wrap.innerHTML = `
    ${botAvatar()}
    <div class="msg-body">
      <div class="msg-head">
        <span class="msg-name bot">Research Assistant</span>
      </div>
      <div class="typing-dots"><span></span><span></span><span></span></div>
    </div>`;
  els.messages.appendChild(wrap);
  scrollToBottom();
}

function removeTyping() {
  const t = document.getElementById("typing-indicator");
  if (t) t.remove();
}

function showNotice(text) {
  removeTyping();
  const n = document.createElement("div");
  n.className = "notice";
  n.textContent = text;
  els.messages.appendChild(n);
  scrollToBottom();
}

// ---------- API ----------

async function apiStart() {
  const res = await fetch("/api/start", { method: "POST" });
  if (!res.ok) throw new Error("Could not start a session.");
  const data = await res.json();
  return data.session_id;
}

async function apiSend(message) {
  const res = await fetch("/api/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, message }),
  });
  if (!res.ok) {
    let detail = "Something went wrong.";
    try {
      const err = await res.json();
      if (err && err.detail) detail = err.detail;
    } catch (_) {}
    throw new Error(detail);
  }
  return (await res.json()).messages || [];
}

// ---------- session lifecycle ----------

async function ensureSession() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    sessionId = stored;
    els.connStatus.textContent = "connected";
    setStatus("connected");
    // Best-effort: hydrate prior transcript.
    try {
      const res = await fetch(
        "/api/history?session_id=" + encodeURIComponent(sessionId)
      );
      if (res.ok) {
        const data = await res.json();
        renderTranscript(data.messages || []);
        return;
      }
    } catch (_) {}
    showWelcome();
    return;
  }
  await startNewSession();
}

async function startNewSession() {
  setStatus("connecting...", "typing");
  els.connStatus.textContent = "connecting...";
  try {
    sessionId = await apiStart();
    localStorage.setItem(STORAGE_KEY, sessionId);
    setStatus("connected");
    els.connStatus.textContent = "connected";
    showWelcome();
  } catch (err) {
    setStatus("offline", "error");
    els.connStatus.textContent = "offline";
    showNotice(err.message || "Could not connect to the assistant.");
  }
}

// ---------- send flow ----------

async function handleSend(text) {
  if (!sessionId) {
    showNotice("No active session. Try 'New chat'.");
    return;
  }
  sending = true;
  els.send.disabled = true;

  // If we were showing the welcome hero, clear it before first message.
  if (document.querySelector(".welcome")) {
    els.messages.innerHTML = "";
    renderedCount = 0;
  }

  renderMessage("user", text);
  renderedCount += 1;
  scrollToBottom();

  setStatus("assistant is typing...", "typing");
  showTyping();

  try {
    const messages = await apiSend(text);
    removeTyping();
    // Append only messages we haven't rendered yet (skip system lines).
    const visible = messages.filter((m) => m.role !== "system");
    for (let i = renderedCount; i < visible.length; i++) {
      renderMessage(visible[i].role, visible[i].content);
    }
    renderedCount = visible.length;
    setStatus("connected");
    scrollToBottom();
  } catch (err) {
    showNotice(err.message || "The assistant could not respond.");
    setStatus("error", "error");
  } finally {
    sending = false;
    els.send.disabled = false;
    els.input.focus();
  }
}

// ---------- events ----------

function autoGrow() {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 180) + "px";
}

els.input.addEventListener("input", autoGrow);

els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    els.form.requestSubmit();
  }
});

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.input.value.trim();
  if (!text || sending) return;
  els.input.value = "";
  autoGrow();
  handleSend(text);
});

els.newChat.addEventListener("click", async () => {
  if (sending) return;
  localStorage.removeItem(STORAGE_KEY);
  sessionId = null;
  await startNewSession();
  els.input.focus();
});

// ---------- boot ----------
ensureSession().then(() => els.input.focus());
