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

const messageEl = document.getElementById("message");
const composer = document.getElementById("composer");
const sentState = document.getElementById("sentState");

let baseFriends = 0;
async function loadLink() {
  try {
    const data = await (await fetch(`/api/link?slug=${encodeURIComponent(slug)}`)).json();
    const owner = data.owner || "losthusky";
    document.getElementById("handle").textContent = "@" + owner;
    document.title = "@" + owner;
    if (data.link?.prompt) document.getElementById("prompt").textContent = data.link.prompt;
    if (typeof data.views === "number") {
      baseFriends = data.views;
      document.getElementById("friends").textContent = baseFriends;
      startFriendsFluctuation();
    }
  } catch {}
}

// Cosmetic "N friends just tapped the button" counter that gently drifts,
// like ngl.link's own social-proof counter. Purely visual — the real view
// count (from D1) is the seed; this doesn't write anything back.
function startFriendsFluctuation() {
  const el = document.getElementById("friends");
  setInterval(() => {
    const drift = Math.floor(Math.random() * 5) - 1; // -1..+3, biased upward
    baseFriends = Math.max(0, baseFriends + drift);
    el.textContent = baseFriends;
  }, 2200 + Math.random() * 1800);
}

async function logView() {
  try {
    await fetch("/api/view", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(await signals()),
    });
  } catch {}
}

// ---- random question generator (ngl.link style) ----
const RANDOM_QUESTIONS = [
  "are u single?",
  "are u talking to anyone rn??",
  "who's your crush? 👀",
  "what do u really think of me?",
  "rate me 1-10, be honest",
  "what's my best feature?",
  "biggest ick?",
  "what's your red flag?",
  "what's your green flag?",
  "hot take?",
  "spill the tea ☕",
  "what's a secret you've never told anyone?",
  "who was your first kiss?",
  "do you have a crush on me? 👀",
  "if we dated where would you take me?",
  "what's the most embarrassing thing you've done?",
  "what would you change about me?",
  "am i cute or hot? pick one",
  "what's your toxic trait?",
  "describe me in 3 words",
  "what's the last lie you told?",
  "would you date me? no cap",
  "what's your love language?",
  "biggest turn off?",
  "what's your guilty pleasure song?",
  "who's your celebrity crush?",
  "what's the wildest thing you've done?",
  "have you ever lied to me?",
  "what's a rumor you've heard about me?",
  "what's your favorite thing about me?",
  "what's your biggest fear?",
  "send me a confession 👀",
  "what's your worst habit?",
  "would you kiss me?",
  "what's your unpopular opinion?",
  "what's your dream date?",
  "who's your best friend and why?",
  "what's your comfort show?",
  "what's your biggest regret?",
  "am i your type? 😏",
  "what's the first thing you noticed about me?",
  "who's the last person you texted?",
  "what's your zodiac sign?",
  "do you believe in love at first sight?",
  "what's the nicest thing anyone's done for you?",
  "what's your biggest flex?",
  "what's your biggest insecurity?",
  "if you could date anyone here, who?",
  "what's your dream job?",
  "coffee or tea?",
  "what's your dream car?",
  "what's your morning routine?",
  "who do you miss rn?",
  "what's a hill you'll die on?",
  "would you rather text or call?",
  "what's your go-to karaoke song?",
  "what's something you find attractive?",
  "have you ever had a crush on me?",
  "what's your worst date story?",
  "what's your favorite memory with me?",
  "what's the tea on your ex?",
  "who's the funniest person you know?",
  "drop a compliment 💗",
  "what's your dream vacation?",
  "single or taken?",
  "what song reminds you of me?",
  "what's the last thing that made you cry?",
  "what's your opinion on me, no filter",
  "any advice for me?",
  "what should i post next?",
];
// Dice writes the suggestion as real, editable text in the box (not just a
// placeholder). Until the sender focuses/types, it keeps auto-rotating —
// starting from the plain "ask me anything" placeholder, then cycling.
let currentQuestion = "";
let lastQ = -1;
let rotateTimer = null;
let userInteracting = false;

function pickQuestion() {
  let i;
  do { i = Math.floor(Math.random() * RANDOM_QUESTIONS.length); } while (i === lastQ && RANDOM_QUESTIONS.length > 1);
  lastQ = i;
  return RANDOM_QUESTIONS[i];
}
function setSuggestion(q) {
  currentQuestion = q;
  messageEl.value = q;
}
function startRotation() {
  clearInterval(rotateTimer);
  rotateTimer = setInterval(() => {
    if (userInteracting) { clearInterval(rotateTimer); return; }
    setSuggestion(pickQuestion());
  }, 2800);
}
function stopRotation() {
  userInteracting = true;
  clearInterval(rotateTimer);
}

messageEl.addEventListener("focus", stopRotation);
messageEl.addEventListener("input", () => { stopRotation(); currentQuestion = ""; });

document.getElementById("diceBtn").addEventListener("click", () => {
  setSuggestion(pickQuestion());
  messageEl.focus();
});

// Box starts empty with the "ask me anything..." placeholder, then after a
// short pause begins rotating real suggestion text — unless the sender has
// already started typing.
setTimeout(() => {
  if (userInteracting) return;
  setSuggestion(pickQuestion());
  startRotation();
}, 1800);

const form = document.getElementById("sendForm");
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("sendBtn");
  // empty box → send the currently suggested question (ngl behaviour)
  const message = (messageEl.value.trim() || currentQuestion || "").trim();
  const handle = document.getElementById("handleField").value.trim();
  if (!message) { messageEl.focus(); return; }
  btn.disabled = true; btn.textContent = "Sending...";
  try {
    const res = await fetch("/api/send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(await signals()), message, handle }),
    });
    if (res.status === 429) { toast("Slow down a sec 🙏"); return; }
    const data = await res.json();
    if (!data.ok) { toast("Something went wrong"); return; }
    composer.classList.add("hidden");
    sentState.classList.remove("hidden");
  } catch { toast("Network error"); }
  finally { btn.disabled = false; btn.textContent = "Send!"; }
});

document.getElementById("againBtn").addEventListener("click", () => {
  userInteracting = false;
  messageEl.placeholder = "ask me anything...";
  setSuggestion(pickQuestion());
  startRotation();
  sentState.classList.add("hidden");
  composer.classList.remove("hidden");
});

loadLink();
logView();
