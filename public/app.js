// Send page: load link meta, collect consensual device signals, log a view,
// and submit messages. A persistent clientId (localStorage) keeps the sender
// linked across sessions and IP/WiFi changes.

const slug = decodeURIComponent(location.pathname.replace(/^\/+|\/+$/g, ""));

function clientId() {
  try {
    let id = localStorage.getItem("lh_cid");
    if (!id) { id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random(); localStorage.setItem("lh_cid", id); }
    return id;
  } catch { return ""; }
}

async function signals() {
  const s = {
    slug,
    clientId: clientId(),
    vw: window.innerWidth, vh: window.innerHeight,
    screen: `${screen.width * (window.devicePixelRatio || 1) | 0}x${screen.height * (window.devicePixelRatio || 1) | 0}`,
    dpr: window.devicePixelRatio || 1,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    langs: (navigator.languages || [navigator.language]).join(","),
    platform: navigator.platform || "",
    cores: navigator.hardwareConcurrency || 0,
    mem: navigator.deviceMemory || "",
    touch: navigator.maxTouchPoints || 0,
    colorDepth: screen.colorDepth || 0,
  };
  try {
    if (navigator.userAgentData?.getHighEntropyValues) {
      const h = await navigator.userAgentData.getHighEntropyValues(["model", "platform", "platformVersion"]);
      if (h.model) s.model = h.model;
      if (h.platform) s.platform = h.platform + (h.platformVersion ? " " + h.platformVersion : "");
    }
  } catch {}
  return s;
}

function toast(text) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

async function loadLink() {
  try {
    const data = await (await fetch(`/api/link?slug=${encodeURIComponent(slug)}`)).json();
    const owner = data.owner || "losthusky";
    document.getElementById("handle").textContent = "@" + owner;
    document.title = "@" + owner;
    if (data.link?.prompt) document.getElementById("prompt").textContent = data.link.prompt;
  } catch {}
}

async function logView() {
  try {
    await fetch("/api/view", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(await signals()),
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
  btn.disabled = true; btn.textContent = "Sending...";
  try {
    const res = await fetch("/api/send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(await signals()), message, handle }),
    });
    if (res.status === 429) { toast("Slow down a sec 🙏"); return; }
    const data = await res.json();
    if (!data.ok) { toast("Something went wrong"); return; }
    form.classList.add("hidden");
    document.getElementById("sentState").classList.remove("hidden");
  } catch { toast("Network error"); }
  finally { btn.disabled = false; btn.textContent = "Send!"; }
});

document.getElementById("againBtn").addEventListener("click", () => {
  document.getElementById("message").value = "";
  document.getElementById("sentState").classList.add("hidden");
  form.classList.remove("hidden");
});

loadLink();
logView();
