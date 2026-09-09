"use strict";

const els = {
  app: document.getElementById("app"),
  overlay: document.getElementById("connection-overlay"),
  overlayTitle: document.getElementById("overlay-title"),
  overlayMsg: document.getElementById("overlay-msg"),
  overlayRetry: document.getElementById("overlay-retry"),
  messages: document.getElementById("messages"),
  form: document.getElementById("composer-form"),
  input: document.getElementById("composer-input"),
  send: document.getElementById("send-btn"),
  channelList: document.getElementById("channel-list"),
  channelEmpty: document.getElementById("channel-empty"),
  addChannel: document.getElementById("add-channel"),
  railAdd: document.getElementById("rail-add"),
  activeChannelName: document.getElementById("active-channel-name"),
  headerStatus: document.getElementById("header-status"),
  connStatus: document.getElementById("conn-status"),
};

const CHANNELS_KEY = "research_channels";
const ACTIVE_KEY = "research_active_channel";

let channels = []; // [{ id, name, sessionId }]
let activeId = null;
let sending = false;
let renderedCount = 0; // transcript messages already drawn for the active channel

// ---------- storage ----------

function loadChannels() {
  try {
    channels = JSON.parse(localStorage.getItem(CHANNELS_KEY) || "[]");
  } catch (_) {
    channels = [];
  }
  activeId = localStorage.getItem(ACTIVE_KEY);
  if (!channels.some((c) => c.id === activeId)) activeId = null;
}

function saveChannels() {
  localStorage.setItem(CHANNELS_KEY, JSON.stringify(channels));
  if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
  else localStorage.removeItem(ACTIVE_KEY);
}

function activeChannel() {
  return channels.find((c) => c.id === activeId) || null;
}

function uid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : "c-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

// ---------- helpers ----------

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : text;
  return div.innerHTML;
}

function formatPlain(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return html;
}

function formatMarkdown(text) {
  const source = text == null ? "" : String(text);
  if (window.marked && window.DOMPurify) {
    const rawHtml = window.marked.parse(source, { breaks: true, gfm: true });
    return window.DOMPurify.sanitize(rawHtml, { ADD_ATTR: ["target", "rel"] });
  }
  return formatPlain(source);
}

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

// ---------- connection overlay ----------

function showOverlayConnecting() {
  els.overlay.classList.remove("error");
  els.overlay.hidden = false;
  els.overlayTitle.textContent = "Connecting to AMP";
  els.overlayMsg.textContent = "Checking that the automation is live and running.";
  els.overlayRetry.hidden = true;
}

function showOverlayError(message) {
  els.overlay.classList.add("error");
  els.overlay.hidden = false;
  els.overlayTitle.textContent = "Can't reach the automation";
  els.overlayMsg.textContent =
    message || "The AMP automation did not respond. Check the deployment and try again.";
  els.overlayRetry.hidden = false;
}

function hideOverlay() {
  els.overlay.hidden = true;
}

async function connect() {
  showOverlayConnecting();
  try {
    const res = await fetch("/api/health");
    if (!res.ok) {
      let detail = "Health check failed.";
      try {
        const err = await res.json();
        if (err && err.detail) detail = String(err.detail);
      } catch (_) {}
      throw new Error(detail);
    }
    await res.json(); // { ok, health, inputs }
    hideOverlay();
    els.app.hidden = false;
    els.connStatus.textContent = "connected";
    initChannels();
  } catch (err) {
    showOverlayError(err.message);
  }
}

// ---------- message rendering ----------

function showChannelWelcome(name) {
  els.messages.innerHTML = `
    <div class="welcome">
      <div class="welcome-mark"><span class="mark-curve"></span></div>
      <h1>#${escapeHtml(name)}</h1>
      <p>
        I can only search the web for information. Ask me to look something up,
        and I'll find current answers online. I won't do other tasks.
      </p>
    </div>`;
}

function showNoChannel() {
  els.messages.innerHTML = `
    <div class="welcome">
      <div class="welcome-mark"><span class="mark-curve"></span></div>
      <h1>No channel selected</h1>
      <p>Create a channel with the + button to start a new conversation.</p>
    </div>`;
}

function renderMessage(role, content, opts = {}) {
  const isBot = role !== "user";
  const wrap = document.createElement("div");
  wrap.className = "msg " + (isBot ? "bot" : "user");

  const avatar = isBot ? botAvatar() : '<span class="avatar avatar-user">You</span>';
  const name = isBot ? "Research Assistant" : "You";
  const nameClass = isBot ? "msg-name bot" : "msg-name";

  const textHtml = isBot ? formatMarkdown(content) : formatPlain(content);
  const textClass = isBot ? "msg-text markdown" : "msg-text plain";

  wrap.innerHTML = `
    ${avatar}
    <div class="msg-body">
      <div class="msg-head">
        <span class="${nameClass}">${name}</span>
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
  const visible = (messages || []).filter((m) => m.role !== "system");
  if (visible.length === 0) {
    const ch = activeChannel();
    showChannelWelcome(ch ? ch.name : "channel");
    return;
  }
  for (const m of visible) {
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
      <div class="msg-head"><span class="msg-name bot">Research Assistant</span></div>
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

// ---------- channels UI ----------

function setComposerEnabled(enabled) {
  els.input.disabled = !enabled;
  els.send.disabled = !enabled;
  const ch = activeChannel();
  els.input.placeholder = enabled
    ? "Message #" + (ch ? ch.name : "channel")
    : "Create or select a channel to start";
}

function renderChannels() {
  els.channelList.innerHTML = "";
  els.channelEmpty.hidden = channels.length > 0;

  for (const ch of channels) {
    const item = document.createElement("div");
    item.className = "channel" + (ch.id === activeId ? " active" : "");
    item.dataset.id = ch.id;
    item.innerHTML = `
      <span class="hash">#</span>
      <span class="channel-name">${escapeHtml(ch.name)}</span>
      <button class="channel-del" title="Delete channel" aria-label="Delete channel">&times;</button>`;
    item.addEventListener("click", (e) => {
      if (e.target.closest(".channel-del")) return;
      switchChannel(ch.id);
    });
    item
      .querySelector(".channel-del")
      .addEventListener("click", (e) => {
        e.stopPropagation();
        deleteChannel(ch.id);
      });
    els.channelList.appendChild(item);
  }
}

async function switchChannel(id) {
  if (sending) return;
  const ch = channels.find((c) => c.id === id);
  if (!ch) return;
  activeId = id;
  saveChannels();
  renderChannels();
  els.activeChannelName.textContent = ch.name;
  setComposerEnabled(true);
  setStatus("connected");

  // Load stored transcript for this channel's session.
  try {
    const res = await fetch(
      "/api/history?session_id=" + encodeURIComponent(ch.sessionId)
    );
    if (res.ok) {
      const data = await res.json();
      renderTranscript(data.messages || []);
    } else {
      showChannelWelcome(ch.name);
    }
  } catch (_) {
    showChannelWelcome(ch.name);
  }
  els.input.focus();
}

function defaultChannelName() {
  let n = channels.length + 1;
  let name = "channel-" + n;
  const taken = new Set(channels.map((c) => c.name));
  while (taken.has(name)) {
    n += 1;
    name = "channel-" + n;
  }
  return name;
}

async function addChannel() {
  if (sending) return;
  const raw = window.prompt("Channel name", defaultChannelName());
  if (raw === null) return; // cancelled
  const name = raw.trim().replace(/^#+/, "").trim() || defaultChannelName();

  els.addChannel.disabled = true;
  els.railAdd.disabled = true;
  try {
    const res = await fetch("/api/start", { method: "POST" });
    if (!res.ok) throw new Error("start failed");
    const data = await res.json();
    const ch = { id: uid(), name, sessionId: data.session_id };
    channels.push(ch);
    activeId = ch.id;
    saveChannels();
    renderChannels();
    await switchChannel(ch.id);
  } catch (err) {
    showOverlayError("Could not create a channel session on AMP.");
  } finally {
    els.addChannel.disabled = false;
    els.railAdd.disabled = false;
  }
}

function deleteChannel(id) {
  const ch = channels.find((c) => c.id === id);
  if (!ch) return;
  if (!window.confirm(`Delete #${ch.name}? This clears it from this browser.`)) return;
  channels = channels.filter((c) => c.id !== id);
  if (activeId === id) activeId = channels.length ? channels[0].id : null;
  saveChannels();
  renderChannels();
  if (activeId) {
    switchChannel(activeId);
  } else {
    els.activeChannelName.textContent = "select a channel";
    setComposerEnabled(false);
    showNoChannel();
  }
}

function initChannels() {
  loadChannels();
  renderChannels();
  if (activeId) {
    switchChannel(activeId);
  } else if (channels.length) {
    switchChannel(channels[0].id);
  } else {
    els.activeChannelName.textContent = "select a channel";
    setComposerEnabled(false);
    showNoChannel();
  }
}

// ---------- send flow ----------

async function apiSend(sessionId, message) {
  const res = await fetch("/api/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, message }),
  });
  if (!res.ok) {
    let detail = "Something went wrong.";
    try {
      const err = await res.json();
      if (err && err.detail) detail = String(err.detail);
    } catch (_) {}
    throw new Error(detail);
  }
  return (await res.json()).messages || [];
}

async function handleSend(text) {
  const ch = activeChannel();
  if (!ch) {
    showNotice("Create or select a channel first.");
    return;
  }
  sending = true;
  els.send.disabled = true;

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
    const messages = await apiSend(ch.sessionId, text);
    removeTyping();
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
  if (!text || sending || els.input.disabled) return;
  els.input.value = "";
  autoGrow();
  handleSend(text);
});

els.addChannel.addEventListener("click", addChannel);
els.railAdd.addEventListener("click", addChannel);
els.overlayRetry.addEventListener("click", connect);

// ---------- boot ----------
connect();
