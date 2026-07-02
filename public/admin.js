// Admin dashboard: auth, inbox, per-sender profile (NGL-style), link creation,
// share-to-Instagram-story (2K canvas -> Web Share API).

const $ = (id) => document.getElementById(id);
const api = (p, o) => fetch(p, o).then((r) => r.json().then((j) => ({ status: r.status, ...j })));
const esc = (s) => (s == null ? "" : String(s)).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ago = (ts) => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
};
const AVATARS = ["🦋", "🐺", "🦊", "🐧", "🦁", "🐼", "🐸", "🦉", "🐙", "🦄", "🐯", "🐨", "🦖", "🐳", "🦅", "🐝"];
const avatarFor = (id) => { let h = 0; for (const c of id || "") h = (h * 31 + c.charCodeAt(0)) >>> 0; return AVATARS[h % AVATARS.length]; };
const unameFor = (id) => "user_" + (id || "").replace(/-/g, "").slice(-6);
const HOSTING_RE = /\b(host(?:ing)?|vpn|proxy|datacenter|data ?center|colo(?:cation)?|cloud|digitalocean|amazon|aws|google ?cloud|microsoft ?azure|\bovh\b|linode|vultr|contabo|leaseweb|hetzner|choopa|m247|psychz|server(?:s)?\b)/i;
const looksHosting = (isp) => !!(isp && HOSTING_RE.test(isp));
function mapsUrl(e) {
  if (e.lat != null && e.lon != null && e.lat !== 0 && e.lon !== 0) return `https://www.google.com/maps?q=${e.lat},${e.lon}`;
  const q = [e.city, e.region, e.country].filter(Boolean).join(", ");
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : "";
}

// ---------- auth ----------
async function checkAuth() { if ((await api("/api/admin/me")).authed) showDash(); }
// password show/hide
$("eyeBtn").addEventListener("click", () => {
  const inp = $("password");
  const show = inp.type === "password";
  inp.type = show ? "text" : "password";
  $("eyeBtn").setAttribute("aria-label", show ? "Hide password" : "Show password");
  $("eyeIcon").innerHTML = show
    ? '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68M6.6 6.6A13.3 13.3 0 0 0 2 11s3.5 7 10 7a9.1 9.1 0 0 0 5.4-1.6M1 1l22 22"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'
    : '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>';
});

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("unlockBtn"), label = $("unlockLabel"), field = $("pwField"), err = $("loginErr");
  err.textContent = ""; field.classList.remove("err");
  btn.disabled = true; btn.classList.remove("ok");
  label.innerHTML = '<span class="spinner"></span> Unlocking...';
  try {
    const r = await api("/api/admin/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: $("password").value }),
    });
    if (r.ok) {
      field.classList.add("ok"); btn.classList.add("ok"); label.textContent = "✓ Unlocked";
      setTimeout(showDash, 450);
    } else if (r.status === 429) {
      throw new Error("Too many attempts — wait a moment.");
    } else {
      throw new Error("Wrong password.");
    }
  } catch (ex) {
    field.classList.add("err", "shake");
    err.textContent = ex.message || "Something went wrong.";
    setTimeout(() => field.classList.remove("shake"), 500);
    btn.disabled = false; label.textContent = "Unlock";
    $("password").focus(); $("password").select();
  }
});
$("logoutBtn").addEventListener("click", async () => { await api("/api/admin/logout", { method: "POST" }); location.reload(); });
function showDash() {
  $("loginView").classList.add("hidden"); $("dashView").classList.remove("hidden"); loadAll();
  // Telegram notifications link to /admin#v=<visitorId> — auto-open that profile.
  const m = location.hash.match(/^#v=(.+)$/);
  if (m) setTimeout(() => whoSent(decodeURIComponent(m[1])), 250);
}

// ---------- data ----------
function loadAll() { loadStats(); loadInbox(); }
async function loadStats() {
  const r = await api("/api/admin/stats"); if (!r.ok) return;
  const s = r.stats;
  $("stats").innerHTML = [["Messages", s.messages], ["Unread", s.unread], ["Views", s.views], ["Senders", s.visitors]]
    .map(([l, n]) => `<div class="stat"><div class="n">${n || 0}</div><div class="l">${l}</div></div>`).join("");
}

let MSG_CACHE = {};
async function loadInbox() {
  const r = await api("/api/admin/messages");
  const el = $("inboxTab"); MSG_CACHE = {};
  if (!r.ok || !r.messages.length) { el.innerHTML = `<p class="muted">No messages yet.</p>`; return; }
  r.messages.forEach((m) => (MSG_CACHE[m.id] = m));
  el.innerHTML = r.messages.map(renderMessage).join("");
  r.messages.filter((m) => !m.is_read).forEach((m) => api(`/api/admin/message/${m.id}/read`, { method: "POST" }));
}

function renderMessage(m) {
  const loc = [m.city, m.region, m.country].filter(Boolean).join(", ") || "unknown location";
  const dev = m.device_model || m.device || "device?";
  const maps = mapsUrl(m);
  const chips = [
    maps ? { t: `📍 ${esc(loc)}`, href: maps } : `📍 ${esc(loc)}`,
    `📱 ${esc(dev)}`,
    m.os ? `⚙️ ${esc(m.os)} ${esc(m.os_version || "")}` : "",
    m.source ? `🌐 ${esc(m.source)}` : "",
    m.isp ? `📡 ${esc(m.isp)}` : "",
    looksHosting(m.isp) ? { t: "⚠️ possible VPN/proxy", hot: 1 } : "",
    m.handle ? { t: `@${esc(m.handle)}`, hot: 1 } : "",
  ].filter(Boolean).map((c) => {
    if (typeof c === "string") return `<span class="chip">${c}</span>`;
    if (c.href) return `<a class="chip" href="${c.href}" target="_blank" rel="noopener">${c.t} ↗</a>`;
    return `<span class="chip hot">${c.t}</span>`;
  });
  return `<div class="msg ${m.is_read ? "" : "unread"}">
    <div class="body">${esc(m.body)}</div>
    <div class="meta">${chips.join("")}</div>
    <div class="time">${ago(m.created_at)} · ✉️ ${m.sender_messages} · 👀 ${m.sender_views} · IP ${esc(m.ip || "?")}</div>
    <div class="row">
      <button class="btn primary" onclick="whoSent('${m.visitor_id}')">Who sent this 👀</button>
      <button class="btn" onclick="shareStory(${m.id})">Share to story</button>
      <button class="btn danger" onclick="delMsg(${m.id})">Delete</button>
    </div></div>`;
}

// ---------- sender profile ----------
window.whoSent = async function (visitorId) {
  const r = await api(`/api/admin/visitor/${encodeURIComponent(visitorId)}`);
  if (!r.ok) return;
  const v = r.visitor;
  const e = r.events[0] || {};
  const views = r.events.filter((x) => x.type === "view").length;

  const kv = (ico, k, val) => `<div class="kv"><span class="k"><span class="ico">${ico}</span>${k}</span><span class="v">${esc(val || "—")}</span></div>`;
  const loc = [e.city, e.region, e.country].filter(Boolean).join(", ");
  const coords = e.lat ? `${e.lat},${e.lon}` : "";
  const eMaps = mapsUrl(e);
  const mapEmbed = coords
    ? `<div class="mapwrap"><iframe loading="lazy" src="https://maps.google.com/maps?q=${coords}&z=11&output=embed"></iframe></div>
       <div class="locpill">📍 ${esc(loc || "Unknown")} ${eMaps ? `<a href="${eMaps}" target="_blank" rel="noopener" style="color:#ff9db0;font-weight:700;margin-left:6px">Open in Google Maps ↗</a>` : ""}</div>`
    : `<p class="muted">No location captured.</p>`;
  const hostingWarn = looksHosting(e.isp)
    ? `<p class="muted" style="color:#ff9db0;margin-top:6px">⚠️ ISP name matches hosting/VPN/proxy patterns — may not be a real residential visitor.</p>` : "";

  const model = e.device_model || (e.device === "desktop" ? "Desktop / Laptop" : "Unknown device");
  const modelNote = e.model_source === "viewport" ? " (from screen size)" : "";

  const history = r.events.slice(0, 20).map((x) => {
    const xMaps = mapsUrl(x);
    return `<div class="kv"><span class="k">${x.type === "view" ? "👀 view" : "💌 message"} · ${ago(x.created_at)}</span>
     <span class="v">${xMaps ? `<a href="${xMaps}" target="_blank" rel="noopener" style="color:#ff9db0">` : ""}${esc([x.city, x.country].filter(Boolean).join(", ") || "—")}${xMaps ? "</a>" : ""} · ${esc(x.source || "")}</span></div>`;
  }).join("");

  openModal(`
    <div class="modal-head">
      <h2>Sender Hints <span class="pro-badge">PRO</span></h2>
      <button class="x" onclick="closeModal()">×</button>
    </div>
    <div class="mbody">
      <div class="profile-hero">
        <div class="avatar-lg">${avatarFor(v.id)}</div>
        <div class="uname">@${esc(v.handle || unameFor(v.id))}</div>
        <div class="counts">
          <div class="c"><b>${r.messages.length}</b><span>Messages</span></div>
          <div class="c"><b>${views}</b><span>Views</span></div>
          <div class="c"><b>${esc(v.first_seen ? new Date(v.first_seen).toLocaleDateString() : "—")}</b><span>First seen</span></div>
        </div>
      </div>

      <div class="sect-title">📍 Location</div>
      ${mapEmbed}
      ${hostingWarn}

      <div class="sect-title">📱 Device</div>
      <div class="panel">
        ${kv("📱", "phone", model + modelNote)}
        ${kv("⚙️", "software", [e.os, e.os_version].filter(Boolean).join(" "))}
        ${kv("📡", "carrier / isp", e.isp ? `${e.isp}${e.asn ? " (AS" + e.asn + ")" : ""}` : "")}
        ${kv("🌐", "sent from", e.source)}
        ${kv("🧭", "browser", [e.browser, e.browser_version].filter(Boolean).join(" "))}
        ${kv("🕐", "time sent", e.created_at ? new Date(e.created_at).toLocaleString() : "")}
      </div>

      <div class="sect-title">🧬 Fingerprint</div>
      <div class="panel">
        ${kv("🌍", "IP address", e.ip)}
        ${kv("🗺️", "timezone", e.timezone)}
        ${kv("🈳", "language", e.lang)}
        ${kv("📐", "viewport / screen", [e.viewport, e.screen].filter(Boolean).join(" · "))}
        ${kv("🔎", "pixel ratio", e.dpr)}
        ${kv("💻", "platform", e.platform)}
        ${kv("⚡", "cpu / memory", [e.cores ? e.cores + " cores" : "", e.mem ? e.mem + " GB" : ""].filter(Boolean).join(" · "))}
        ${kv("✋", "touch points", e.touch)}
      </div>

      <div class="sect-title">🕘 Recent activity</div>
      <div class="panel hist">${history || '<p class="muted" style="padding:10px 0">none</p>'}</div>
    </div>`);
};

window.delMsg = async function (id) {
  if (!confirm("Delete this message?")) return;
  await api(`/api/admin/message/${id}`, { method: "DELETE" });
  loadInbox(); loadStats();
};

// ---------- Instagram story (2K) ----------
window.shareStory = async function (id) {
  const m = MSG_CACHE[id]; if (!m) return;
  const c = $("storyCanvas"), ctx = c.getContext("2d"), W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);
  // dark backdrop like the NGL story
  ctx.fillStyle = "#0d0f18"; ctx.fillRect(0, 0, W, H);

  const cardW = W - 220, cardX = 110, cardY = H * 0.30, radius = 56;
  const headH = 300;
  // header gradient
  const g = ctx.createLinearGradient(cardX, 0, cardX + cardW, 0);
  g.addColorStop(0, "#ff2e74"); g.addColorStop(1, "#ff9a3c");
  roundRectPath(ctx, cardX, cardY, cardW, headH, radius, radius, 0, 0); ctx.fillStyle = g; ctx.fill();
  // body
  const bodyH = 560;
  roundRectPath(ctx, cardX, cardY + headH, cardW, bodyH, 0, 0, radius, radius);
  ctx.fillStyle = "#1c2230"; ctx.fill();

  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  ctx.font = "800 62px -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText("send me a message!", W / 2, cardY + 175);

  ctx.font = "700 66px -apple-system, Segoe UI, Roboto, sans-serif";
  wrapText(ctx, m.body, W / 2, cardY + headH + 190, cardW - 150, 84);

  // brand footer
  ctx.fillStyle = "#fff";
  ctx.font = "800 60px -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText("losthusky", W / 2, H - 220);
  ctx.fillStyle = "rgba(255,255,255,.55)";
  ctx.font = "600 34px -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText("Q  &  A", W / 2, H - 165);

  const blob = await new Promise((res) => c.toBlob(res, "image/png", 1));
  const file = new File([blob], "losthusky-story.png", { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch {}
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "losthusky-story.png"; a.click();
};
function roundRectPath(ctx, x, y, w, h, tl, tr, br, bl) {
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y); ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br); ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h); ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl); ctx.arcTo(x, y, x + tl, y, tl);
  ctx.closePath();
}
function wrapText(ctx, text, x, y, maxW, lh) {
  const words = (text || "").split(/\s+/); let line = "", ly = y;
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, ly); line = w; ly += lh; }
    else line = test;
  }
  if (line) ctx.fillText(line, x, ly);
}

// ---------- tabs ----------
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
  t.classList.add("active");
  const tab = t.dataset.tab;
  $("inboxTab").classList.toggle("hidden", tab !== "inbox");
  $("sendersTab").classList.toggle("hidden", tab !== "senders");
  $("linksTab").classList.toggle("hidden", tab !== "links");
  $("settingsTab").classList.toggle("hidden", tab !== "settings");
  if (tab === "senders") loadSenders();
  if (tab === "links") loadLinks();
  if (tab === "settings") loadSettings();
}));

const SETTING_META = [
  ["notify_messages", "Notify on new messages", "Telegram ping whenever someone sends you a message."],
  ["notify_views", "Notify on link views", "Telegram ping whenever someone opens your link."],
  ["skip_bot_views", "Hide bot / crawler views", "Skip view notifications from hosting / VPN / proxy networks (Amazon, Cloudflare, datacenters). These are almost always link-preview crawlers, not real people."],
  ["skip_bot_messages", "Hide bot / crawler messages", "Skip message notifications from hosting / VPN / proxy networks. Off by default — real messages are rare and worth seeing even from odd networks."],
];
async function loadSettings() {
  const r = await api("/api/admin/settings");
  const el = $("settingsTab");
  if (!r.ok) { el.innerHTML = `<p class="muted">Couldn't load settings.</p>`; return; }
  const s = r.settings;
  el.innerHTML =
    `<p class="set-note">Choose which notifications reach your Telegram. Bot filtering uses the sender's network — hosting/datacenter/VPN ASNs are treated as likely crawlers. Events are still recorded in the dashboard; only the Telegram ping is suppressed.</p>` +
    SETTING_META.map(([key, title, desc]) => `
      <div class="setrow">
        <div class="txt"><b>${title}</b><span>${desc}</span></div>
        <label class="switch">
          <input type="checkbox" data-key="${key}" ${s[key] === "1" ? "checked" : ""} />
          <span class="slider"></span>
        </label>
      </div>`).join("");
  el.querySelectorAll('input[data-key]').forEach((inp) =>
    inp.addEventListener("change", async () => {
      inp.disabled = true;
      await api("/api/admin/settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [inp.dataset.key]: inp.checked ? 1 : 0 }),
      });
      inp.disabled = false;
    }));
}

async function loadSenders() {
  const r = await api("/api/admin/visitors"); const el = $("sendersTab");
  if (!r.ok || !r.visitors.length) { el.innerHTML = `<p class="muted">No senders yet.</p>`; return; }
  el.innerHTML = r.visitors.map((v) => `
    <div class="listrow">
      <div style="display:flex;align-items:center;gap:12px">
        <div class="avatar-sm">${avatarFor(v.id)}</div>
        <div>
          <div>@${esc(v.handle || unameFor(v.id))}</div>
          <div class="muted">${esc(v.device_model || "")}${v.device_model ? " · " : ""}${esc(v.last_loc || "")}</div>
          <div class="muted">✉️ ${v.messages} · 👀 ${v.views} · ${ago(v.last_seen)}</div>
        </div>
      </div>
      <button class="btn primary" onclick="whoSent('${v.id}')">Details</button>
    </div>`).join("");
}

async function loadLinks() {
  const r = await api("/api/admin/links"); const el = $("linksTab"); if (!r.ok) return;
  el.innerHTML = r.links.map((l) => {
    const url = `${location.origin}/${l.slug}`;
    return `<div class="listrow"><div>
      <a href="${esc(url)}" target="_blank">${esc(url)}</a>
      <div class="muted">✉️ ${l.messages} · 👀 ${l.views} · "${esc(l.prompt)}"</div>
    </div><button class="btn" onclick="navigator.clipboard.writeText('${esc(url)}');this.textContent='Copied'">Copy</button></div>`;
  }).join("") || `<p class="muted">No links.</p>`;
}

$("newLinkBtn").addEventListener("click", () => {
  openModal(`<div class="modal-head"><h2>Create a link</h2><button class="x" onclick="closeModal()">×</button></div>
    <div class="mbody">
      <input id="nlSlug" placeholder="slug (e.g. summer)" style="width:100%;padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:#fff;margin-bottom:10px" />
      <input id="nlPrompt" placeholder="prompt (send me a message!)" style="width:100%;padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:#fff;margin-bottom:12px" />
      <button class="btn primary" style="width:100%" id="nlCreate">Create link</button>
    </div>`);
  $("nlCreate").addEventListener("click", async () => {
    const r = await api("/api/admin/links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: $("nlSlug").value.trim(), prompt: $("nlPrompt").value.trim() }) });
    if (r.ok) { closeModal(); document.querySelector('.tab[data-tab="links"]').click(); } else alert("Invalid slug (use letters, numbers, - or _)");
  });
});

$("refreshBtn").addEventListener("click", loadAll);
function openModal(html) { $("modalRoot").innerHTML = `<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal">${html}</div></div>`; }
window.closeModal = () => ($("modalRoot").innerHTML = "");

checkAuth();
