// Admin dashboard: auth gate, inbox, per-sender analytics, link creation,
// and share-to-Instagram-story (client-side canvas -> Web Share API).

const $ = (id) => document.getElementById(id);
const api = (path, opts) => fetch(path, opts).then((r) => r.json().then((j) => ({ status: r.status, ...j })));
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ago = (ts) => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
};

// ---------- auth ----------
async function checkAuth() {
  const r = await api("/api/admin/me");
  if (r.authed) showDash();
}
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await api("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: $("password").value }),
  });
  if (r.ok) showDash();
  else $("loginErr").style.display = "block";
});
$("logoutBtn").addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" });
  location.reload();
});

function showDash() {
  $("loginView").classList.add("hidden");
  $("dashView").classList.remove("hidden");
  loadAll();
}

// ---------- data ----------
async function loadAll() {
  loadStats();
  loadInbox();
}
async function loadStats() {
  const r = await api("/api/admin/stats");
  if (!r.ok) return;
  const s = r.stats;
  $("stats").innerHTML = [
    ["Messages", s.messages],
    ["Unread", s.unread],
    ["Views", s.views],
    ["Senders", s.visitors],
  ].map(([l, n]) => `<div class="stat"><div class="n">${n || 0}</div><div class="l">${l}</div></div>`).join("");
}

// keep message bodies around for story rendering
let MSG_CACHE = {};
async function loadInbox() {
  const r = await api("/api/admin/messages");
  const el = $("inboxTab");
  MSG_CACHE = {};
  if (!r.ok || !r.messages.length) { el.innerHTML = `<p class="muted2">No messages yet.</p>`; return; }
  r.messages.forEach((m) => (MSG_CACHE[m.id] = m));
  el.innerHTML = r.messages.map(renderMessage).join("");
  r.messages.filter((m) => !m.is_read).forEach((m) =>
    api(`/api/admin/message/${m.id}/read`, { method: "POST" }));
}

function renderMessage(m) {
  const loc = [m.city, m.region, m.country].filter(Boolean).join(", ") || "unknown location";
  const dev = [m.device_model, m.os, m.os_version].filter(Boolean).join(" ") || m.device || "device?";
  const chips = [
    `📍 ${esc(loc)}`,
    `📱 ${esc(dev)}`,
    m.source ? `🌐 ${esc(m.source)}` : "",
    m.isp ? `📡 ${esc(m.isp)}` : "",
    m.handle ? `@${esc(m.handle)}` : "",
    `✉️ ${m.sender_messages} · 👀 ${m.sender_views}`,
  ].filter(Boolean);
  return `
  <div class="msg ${m.is_read ? "" : "unread"}" data-id="${m.id}">
    <p class="body">${esc(m.body)}</p>
    <div class="meta">${chips.map((c) => `<span class="chip">${c}</span>`).join("")}</div>
    <div class="muted2" style="margin-bottom:8px">${ago(m.created_at)} · IP ${esc(m.ip || "?")}</div>
    <div class="row">
      <button class="btn" onclick="whoSent('${m.visitor_id}')">Who sent this?</button>
      <button class="btn" onclick="shareStory(${m.id})">Share to story</button>
      <button class="btn" onclick="delMsg(${m.id})">Delete</button>
    </div>
  </div>`;
}

// ---------- who sent this ----------
window.whoSent = async function (visitorId) {
  const r = await api(`/api/admin/visitor/${visitorId}`);
  if (!r.ok) return;
  const v = r.visitor;
  const latest = r.events[0] || {};
  const rows = [
    ["Handle", v.handle ? "@" + v.handle : "—"],
    ["Messages sent", r.messages.length],
    ["Views", r.events.filter((e) => e.type === "view").length],
    ["First seen", new Date(v.first_seen).toLocaleString()],
    ["Last seen", new Date(v.last_seen).toLocaleString()],
    ["Location", [latest.city, latest.region, latest.country].filter(Boolean).join(", ")],
    ["Coords (approx)", latest.lat ? `${latest.lat}, ${latest.lon}` : "—"],
    ["Timezone", latest.timezone || "—"],
    ["IP", latest.ip || "—"],
    ["ISP / carrier", latest.isp ? `${latest.isp} (AS${latest.asn || "?"})` : "—"],
    ["Device", [latest.device_model, latest.device].filter(Boolean).join(" · ")],
    ["OS", [latest.os, latest.os_version].filter(Boolean).join(" ")],
    ["Browser", [latest.browser, latest.browser_version].filter(Boolean).join(" ")],
    ["Opened from", latest.source || "—"],
    ["Language", latest.lang || "—"],
    ["Screen", latest.screen || "—"],
  ];
  const history = r.events.slice(0, 15).map((e) =>
    `<div class="kv"><span>${e.type === "view" ? "👀 view" : "💌 msg"} · ${ago(e.created_at)}</span>
     <b>${esc([e.city, e.country].filter(Boolean).join(", "))} · ${esc(e.source || "")}</b></div>`).join("");
  openModal(`
    <h2 style="margin:0 0 4px">Sender profile</h2>
    <p class="muted2" style="margin:0 0 14px">${esc(visitorId)}</p>
    ${rows.map(([k, val]) => `<div class="kv"><span>${k}</span><b>${esc(String(val || "—"))}</b></div>`).join("")}
    <h3 style="margin:18px 0 6px;font-size:14px">Recent activity</h3>
    ${history || '<p class="muted2">none</p>'}
    <button class="btn" style="margin-top:16px;width:100%" onclick="closeModal()">Close</button>
  `);
};

window.delMsg = async function (id) {
  if (!confirm("Delete this message?")) return;
  await api(`/api/admin/message/${id}`, { method: "DELETE" });
  loadInbox(); loadStats();
};

// ---------- Instagram story share ----------
window.shareStory = async function (id) {
  const m = MSG_CACHE[id];
  if (!m) return;
  const canvas = $("storyCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#7c3aed"); g.addColorStop(0.55, "#ec4899"); g.addColorStop(1, "#f59e0b");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // card
  const cx = 120, cy = 620, cw = W - 240, ch = 680, r = 60;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, cx, cy, cw, ch, r); ctx.fill();

  ctx.fillStyle = "#6b7280";
  ctx.font = "700 44px -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("send me a message!", W / 2, cy + 110);

  ctx.fillStyle = "#111827";
  ctx.font = "800 60px -apple-system, Segoe UI, Roboto, sans-serif";
  wrapText(ctx, m.body, W / 2, cy + 230, cw - 140, 76);

  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.font = "700 40px -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText("@losthusky", W / 2, cy + ch + 90);

  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  const file = new File([blob], "story.png", { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch {}
  }
  // fallback: download
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "story.png"; a.click();
};
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function wrapText(ctx, text, x, y, maxW, lh) {
  const words = (text || "").split(/\s+/);
  let line = "", ly = y;
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, ly); line = w; ly += lh; }
    else line = test;
  }
  if (line) ctx.fillText(line, x, ly);
}

// ---------- tabs ----------
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    const tab = t.dataset.tab;
    $("inboxTab").classList.toggle("hidden", tab !== "inbox");
    $("sendersTab").classList.toggle("hidden", tab !== "senders");
    $("linksTab").classList.toggle("hidden", tab !== "links");
    if (tab === "senders") loadSenders();
    if (tab === "links") loadLinks();
  }));

async function loadSenders() {
  const r = await api("/api/admin/visitors");
  const el = $("sendersTab");
  if (!r.ok || !r.visitors.length) { el.innerHTML = `<p class="muted2">No senders yet.</p>`; return; }
  el.innerHTML = r.visitors.map((v) => `
    <div class="linkrow">
      <div>
        <div>${v.handle ? "@" + esc(v.handle) : "Anonymous sender"} · <span class="muted2">${esc(v.last_loc || "")}</span></div>
        <div class="muted2">✉️ ${v.messages} messages · 👀 ${v.views} views · ${ago(v.last_seen)}</div>
      </div>
      <button class="btn" onclick="whoSent('${v.id}')">Details</button>
    </div>`).join("");
}

async function loadLinks() {
  const r = await api("/api/admin/links");
  const el = $("linksTab");
  if (!r.ok) return;
  el.innerHTML = r.links.map((l) => {
    const url = `${location.origin}/${l.slug}`;
    return `<div class="linkrow">
      <div>
        <a href="${esc(url)}" target="_blank">${esc(url)}</a>
        <div class="muted2">✉️ ${l.messages} · 👀 ${l.views} · "${esc(l.prompt)}"</div>
      </div>
      <button class="btn" onclick="navigator.clipboard.writeText('${esc(url)}')">Copy</button>
    </div>`;
  }).join("") || `<p class="muted2">No links.</p>`;
}

// ---------- new link ----------
$("newLinkBtn").addEventListener("click", () => {
  openModal(`
    <h2 style="margin:0 0 14px">Create a link</h2>
    <input id="nlSlug" placeholder="slug (e.g. summer)" />
    <input id="nlPrompt" placeholder="prompt (send me a message!)" />
    <button class="btn primary" style="width:100%" id="nlCreate">Create</button>
    <button class="btn" style="width:100%;margin-top:8px" onclick="closeModal()">Cancel</button>
  `);
  $("nlCreate").addEventListener("click", async () => {
    const slug = $("nlSlug").value.trim();
    const prompt = $("nlPrompt").value.trim();
    const r = await api("/api/admin/links", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, prompt }),
    });
    if (r.ok) { closeModal(); document.querySelector('.tab[data-tab="links"]').click(); }
    else alert("Invalid slug");
  });
});

$("refreshBtn").addEventListener("click", loadAll);

// ---------- modal ----------
function openModal(html) {
  $("modalRoot").innerHTML = `<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal">${html}</div></div>`;
}
window.closeModal = () => ($("modalRoot").innerHTML = "");

checkAuth();
