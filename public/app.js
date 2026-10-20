const form = document.getElementById("form");
const questionEl = document.getElementById("question");
const answerEl = document.getElementById("answer");
const sendBtn = document.getElementById("send");
const stopBtn = document.getElementById("stop");

let controller = null;

function setBusy(isBusy) {
  sendBtn.disabled = isBusy;
  stopBtn.hidden = !isBusy;
  answerEl.classList.toggle("streaming", isBusy);
}

// textContent (never innerHTML): model output is untrusted text.
function appendToAnswer(text) {
  answerEl.textContent += text;
}

function showError(message) {
  answerEl.classList.add("error");
  answerEl.textContent += (answerEl.textContent ? "\n\n" : "") + "Error: " + message;
}

// Parse one complete SSE event block ("event: x\ndata: y\n...").
function handleEvent(block) {
  let event = "message";
  const data = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  const text = data.join("\n");
  if (event === "error") showError(text);
  else if (event === "message") appendToAnswer(text);
}

async function ask() {
  const query = questionEl.value.trim();
  if (!query) return;

  answerEl.textContent = "";
  answerEl.classList.remove("error");
  controller = new AbortController();
  setBusy(true);

  try {
    const res = await fetch("/query/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Network chunks don't align with events; only parse complete ones (end with a blank line).
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop();
      blocks.forEach(handleEvent);
    }
  } catch (err) {
    if (err.name !== "AbortError") showError(err.message);
  } finally {
    setBusy(false);
    controller = null;
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  ask();
});

questionEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) ask();
  }
});

stopBtn.addEventListener("click", () => controller && controller.abort());
