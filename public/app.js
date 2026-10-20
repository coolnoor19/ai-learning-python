const chatEl = document.getElementById("chat");
const messagesEl = document.getElementById("messages");
const welcomeEl = document.getElementById("welcome");
const form = document.getElementById("form");
const questionEl = document.getElementById("question");
const sendBtn = document.getElementById("send");
const stopBtn = document.getElementById("stop");
const newChatBtn = document.getElementById("new-chat");
const jumpBtn = document.getElementById("jump");

const MAX_HISTORY = 20; // keep in sync with the server limit
const STORAGE_KEY = "chat-history-v1";

// The conversation sent to the server: [{ role: "user" | "assistant", content }]
let history = [];
let controller = null;
let busy = false;

/* ---------- storage (best effort: may be unavailable in private mode) ---------- */
function saveHistory() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history)); } catch {}
}
function loadHistory() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(data) ? data.filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant")) : [];
  } catch { return []; }
}

/* ---------- markdown rendering ---------- */
// Model output is untrusted: parse Markdown, then sanitize the HTML before inserting it.
function renderMarkdown(text) {
  if (!window.marked || !window.DOMPurify) return null; // CDN blocked: caller falls back to plain text
  const html = DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: true }));
  return html;
}

function enhanceCode(container) {
  container.querySelectorAll("pre > code").forEach((code) => {
    const pre = code.parentElement;
    const lang = (/language-([\w+#-]+)/.exec(code.className) || [])[1] || "";
    if (window.hljs) {
      try {
        if (lang && hljs.getLanguage(lang)) code.className = `hljs language-${lang}`;
        hljs.highlightElement(code);
      } catch {}
    }
    const wrap = document.createElement("div");
    wrap.className = "codeblock";
    const head = document.createElement("div");
    head.className = "codehead";
    const label = document.createElement("span");
    label.textContent = lang || "code";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "copy-code";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => copyText(code.textContent, copy));
    head.append(label, copy);
    pre.replaceWith(wrap);
    wrap.append(head, pre);
  });
  container.querySelectorAll("a").forEach((a) => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
}

async function copyText(text, button) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied!";
  } catch {
    button.textContent = "Failed";
  }
  setTimeout(() => (button.textContent = original), 1500);
}

/* ---------- scrolling ---------- */
function nearBottom() {
  return chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 80;
}
function scrollToBottom(force = false) {
  if (force || nearBottom()) chatEl.scrollTop = chatEl.scrollHeight;
}
chatEl.addEventListener("scroll", () => { jumpBtn.hidden = nearBottom(); });
jumpBtn.addEventListener("click", () => scrollToBottom(true));

/* ---------- message elements ---------- */
function createMessage(role) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "Y" : "✦";
  const wrap = document.createElement("div");
  wrap.className = "bubble-wrap";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  const actions = document.createElement("div");
  actions.className = "actions";
  wrap.append(bubble, actions);
  el.append(avatar, wrap);
  messagesEl.append(el);
  return { el, bubble, actions };
}

function addAction(actions, label, handler) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", () => handler(b));
  actions.append(b);
}

// Re-render at most once per frame while chunks stream in.
function makeRenderer(ref) {
  let pending = false;
  const paint = () => {
    pending = false;
    const html = renderMarkdown(ref.text);
    if (html === null) {
      ref.bubble.textContent = ref.text;
      ref.bubble.style.whiteSpace = "pre-wrap";
    } else {
      ref.bubble.classList.add("md");
      ref.bubble.innerHTML = html;
      enhanceCode(ref.bubble);
    }
    scrollToBottom();
  };
  const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(paint); } };
  return { schedule, flush: paint };
}

function addUserMessage(text) {
  const m = createMessage("user");
  m.bubble.textContent = text;
  return m;
}

function addAssistantMessage(text) {
  const m = createMessage("assistant");
  const ref = { text, bubble: m.bubble };
  makeRenderer(ref).flush();
  attachAssistantActions(m, ref);
  return m;
}

function attachAssistantActions(m, ref) {
  m.actions.textContent = "";
  addAction(m.actions, "Copy", (b) => copyText(ref.text, b));
  addAction(m.actions, "Regenerate", regenerate);
}

// Only the most recent answer can be regenerated.
function pruneRegenerate() {
  const all = messagesEl.querySelectorAll(".msg.assistant:not(.error)");
  all.forEach((el, i) => {
    if (i === all.length - 1) return;
    el.querySelectorAll(".actions button").forEach((b) => b.textContent === "Regenerate" && b.remove());
  });
}

/* ---------- SSE parsing ---------- */
function parseEvent(block) {
  let event = "message";
  const data = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return { event, text: data.join("\n") };
}

/* ---------- UI state ---------- */
function setBusy(isBusy) {
  busy = isBusy;
  sendBtn.hidden = isBusy;
  stopBtn.hidden = !isBusy;
  document.querySelectorAll(".chip").forEach((c) => (c.disabled = isBusy));
}

function updateWelcome() {
  welcomeEl.hidden = history.length > 0 || messagesEl.children.length > 0;
}

function autoGrow() {
  questionEl.style.height = "auto";
  questionEl.style.height = Math.min(questionEl.scrollHeight, 200) + "px";
}

/* ---------- sending ---------- */
async function send(text) {
  text = text.trim();
  if (!text || busy) return;

  history.push({ role: "user", content: text });
  addUserMessage(text);
  questionEl.value = "";
  autoGrow();
  updateWelcome();
  await generate();
}

async function regenerate() {
  if (busy) return;
  // Drop the last assistant answer, then ask again with the same question.
  if (history.length && history[history.length - 1].role === "assistant") history.pop();
  const last = messagesEl.lastElementChild;
  if (last && last.classList.contains("assistant")) last.remove();
  await generate();
}

async function generate() {
  const m = createMessage("assistant");
  m.el.classList.add("streaming");
  m.bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  scrollToBottom(true);

  const ref = { text: "", bubble: m.bubble };
  const renderer = makeRenderer(ref);
  let failed = null;
  controller = new AbortController();
  setBusy(true);

  try {
    const res = await fetch("/query/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history.slice(-MAX_HISTORY) }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(res.status === 422 ? "Message is too long or invalid." : `Server returned ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Network chunks don't align with events; only parse complete ones (they end with a blank line).
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop();
      for (const block of blocks) {
        const { event, text } = parseEvent(block);
        if (event === "error") failed = text;
        else if (event === "message") { ref.text += text; renderer.schedule(); }
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") failed = err.message;
  } finally {
    controller = null;
    m.el.classList.remove("streaming");
    setBusy(false);
  }

  if (ref.text) {
    renderer.flush();
    history.push({ role: "assistant", content: ref.text });
    attachAssistantActions(m, ref);
    pruneRegenerate();
  } else {
    // Nothing was produced (error or stopped early): remove the empty bubble and the unanswered question,
    // and put the question back in the input so it can be retried.
    m.el.remove();
    const lastUser = history.pop();
    const userEl = messagesEl.lastElementChild;
    if (userEl && userEl.classList.contains("user")) userEl.remove();
    if (lastUser && lastUser.role === "user") { questionEl.value = lastUser.content; autoGrow(); }
  }

  if (failed) showError(failed);

  saveHistory();
  updateWelcome();
  scrollToBottom();
  questionEl.focus();
}

function showError(message) {
  const m = createMessage("assistant");
  m.el.classList.add("error");
  m.bubble.textContent = "Error: " + message;
  addAction(m.actions, "Dismiss", () => m.el.remove());
}

/* ---------- events ---------- */
form.addEventListener("submit", (e) => { e.preventDefault(); send(questionEl.value); });

questionEl.addEventListener("input", autoGrow);
questionEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send(questionEl.value);
  }
});

stopBtn.addEventListener("click", () => controller && controller.abort());

newChatBtn.addEventListener("click", () => {
  if (controller) controller.abort();
  history = [];
  messagesEl.textContent = "";
  saveHistory();
  updateWelcome();
  questionEl.focus();
});

document.querySelectorAll(".chip").forEach((chip) =>
  chip.addEventListener("click", () => send(chip.textContent))
);

/* ---------- boot: restore previous conversation ---------- */
history = loadHistory().slice(-MAX_HISTORY);
for (const msg of history) {
  if (msg.role === "user") addUserMessage(msg.content);
  else addAssistantMessage(msg.content);
}
pruneRegenerate();
updateWelcome();
scrollToBottom(true);
