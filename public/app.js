// Send page logic: load link meta, log a consensual view, submit messages.

const slug = decodeURIComponent(location.pathname.replace(/^\/+|\/+$/g, ""));

async function clientHints() {
  const hints = {
    slug,
    screen: `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
  };
  // High-entropy UA client hints (Android exposes the model here).
  try {
    if (navigator.userAgentData?.getHighEntropyValues) {
      const h = await navigator.userAgentData.getHighEntropyValues([
        "model", "platform", "platformVersion", "fullVersionList",
      ]);
      if (h.model) hints.model = h.model;
    }
  } catch {}
  return hints;
}

function toast(text) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

async function loadLink() {
  try {
    const res = await fetch(`/api/link?slug=${encodeURIComponent(slug)}`);
    const data = await res.json();
    const handle = data.link?.title || data.owner || "losthusky";
    document.getElementById("handle").textContent = "@" + (data.owner || handle);
    if (data.link?.prompt) document.getElementById("prompt").textContent = data.link.prompt;
    document.title = "@" + (data.owner || handle);
  } catch {}
}

async function logView() {
  try {
    await fetch("/api/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(await clientHints()),
    });
  } catch {}
}

const form = document.getElementById("sendForm");
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("sendBtn");
  const message = document.getElementById("message").value.trim();
  const handle = document.getElementById("handleField").value.trim();
  if (!message) return;
  btn.disabled = true;
  btn.textContent = "Sending...";
  try {
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(await clientHints()), message, handle }),
    });
    const data = await res.json();
    if (res.status === 429) { toast("Slow down a sec 🙏"); return; }
    if (!data.ok) { toast("Something went wrong"); return; }
    form.classList.add("hidden");
    document.getElementById("sentState").classList.remove("hidden");
  } catch {
    toast("Network error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Send!";
  }
});

document.getElementById("againBtn").addEventListener("click", () => {
  document.getElementById("message").value = "";
  document.getElementById("sentState").classList.add("hidden");
  form.classList.remove("hidden");
});

loadLink();
logView();
