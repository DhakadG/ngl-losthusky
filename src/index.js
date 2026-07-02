import { buildFingerprint } from "./lib/fingerprint.js";
import { verifyPassword, createSession, verifySession, parseCookies } from "./lib/auth.js";
import { notify } from "./lib/notify.js";

const MAX_MSG_LEN = 1000;
const RATE_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_MAX = 8; // max messages per visitor+IP per window

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

function uuid() {
  return crypto.randomUUID();
}

function visitorCookie(id) {
  return `vid=${id}; Path=/; Max-Age=${60 * 60 * 24 * 365 * 2}; HttpOnly; Secure; SameSite=Lax`;
}
function sessionCookie(token) {
  return `sess=${token}; Path=/; Max-Age=${60 * 60 * 24 * 7}; HttpOnly; Secure; SameSite=Lax`;
}
const clearSessionCookie = "sess=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";

async function requireAdmin(request, env) {
  const { sess } = parseCookies(request);
  return sess ? verifySession(sess, env.SESSION_SECRET) : false;
}

// Upsert the visitor row and return its id (from cookie or freshly minted).
async function resolveVisitor(env, request, fp) {
  const cookies = parseCookies(request);
  let id = cookies.vid;
  let isNew = false;
  const now = Date.now();

  if (!id) {
    // Try to match a returning sender by server fingerprint before minting new.
    const found = await env.DB.prepare(
      "SELECT id FROM visitors WHERE fp_hash = ? ORDER BY last_seen DESC LIMIT 1"
    ).bind(fp.fp_hash).first();
    if (found) id = found.id;
    else {
      id = uuid();
      isNew = true;
    }
  }

  await env.DB.prepare(
    `INSERT INTO visitors (id, fp_hash, first_seen, last_seen)
     VALUES (?1, ?2, ?3, ?3)
     ON CONFLICT(id) DO UPDATE SET last_seen = ?3, fp_hash = ?2`
  ).bind(id, fp.fp_hash, now).run();

  return { id, isNew };
}

async function insertEvent(env, type, slug, visitorId, fp) {
  const now = Date.now();
  const r = await env.DB.prepare(
    `INSERT INTO events (type, slug, visitor_id, fp_hash, ip, country, region, city,
      lat, lon, timezone, postal, asn, isp, colo, ua, browser, browser_version,
      os, os_version, device, device_model, source, is_mobile, lang, referer, screen, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    type, slug, visitorId, fp.fp_hash, fp.ip, fp.country, fp.region, fp.city,
    fp.lat, fp.lon, fp.timezone, fp.postal, fp.asn, fp.isp, fp.colo, fp.ua,
    fp.browser, fp.browser_version, fp.os, fp.os_version, fp.device, fp.device_model,
    fp.source, fp.is_mobile, fp.lang, fp.referer, fp.screen, now
  ).run();
  return r.meta.last_row_id;
}

function locString(fp) {
  return [fp.city, fp.region, fp.country].filter(Boolean).join(", ") || "unknown";
}

// ---------- public API ----------

async function handleView(request, env, ctx) {
  const hints = await request.json().catch(() => ({}));
  const slug = (hints.slug || "").toString();
  const fp = await buildFingerprint(request, hints);
  const { id: visitorId } = await resolveVisitor(env, request, fp);
  ctx.waitUntil(insertEvent(env, "view", slug, visitorId, fp).then(() => {}));

  if (env.NOTIFY_ON_VIEW === "true") {
    ctx.waitUntil(
      notify(env, {
        title: `👀 Link opened${slug ? ` (/${slug})` : ""}`,
        lines: [
          `Location: ${locString(fp)}`,
          `Device: ${[fp.device_model, fp.os, fp.os_version].filter(Boolean).join(" ")}`,
          `Source: ${fp.source}`,
          `Network: ${fp.isp || "?"}`,
        ],
      })
    );
  }
  return json({ ok: true, visitorId }, 200, { "Set-Cookie": visitorCookie(visitorId) });
}

async function handleSend(request, env, ctx) {
  const body = await request.json().catch(() => ({}));
  const slug = (body.slug || "").toString();
  const message = (body.message || "").toString().trim();
  const handle = (body.handle || "").toString().trim().slice(0, 60);

  if (!message) return json({ ok: false, error: "empty" }, 400);
  if (message.length > MAX_MSG_LEN) return json({ ok: false, error: "too_long" }, 400);

  const fp = await buildFingerprint(request, body);
  const { id: visitorId } = await resolveVisitor(env, request, fp);

  // Rate limit: recent messages from this visitor OR this IP.
  const since = Date.now() - RATE_WINDOW_MS;
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM messages WHERE created_at > ? AND (visitor_id = ? OR event_id IN (SELECT id FROM events WHERE ip = ? AND created_at > ?))"
  ).bind(since, visitorId, fp.ip, since).first();
  if (recent && recent.n >= RATE_MAX) return json({ ok: false, error: "rate_limited" }, 429);

  if (handle) {
    await env.DB.prepare("UPDATE visitors SET handle = ? WHERE id = ?").bind(handle, visitorId).run();
  }

  const eventId = await insertEvent(env, "message", slug, visitorId, fp);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO messages (slug, visitor_id, body, event_id, created_at) VALUES (?,?,?,?,?)"
  ).bind(slug, visitorId, message, eventId, now).run();

  ctx.waitUntil(
    notify(env, {
      title: "💌 New message" + (handle ? ` from @${handle}` : ""),
      lines: [
        `"${message.slice(0, 180)}"`,
        `Location: ${locString(fp)}`,
        `Device: ${[fp.device_model, fp.os, fp.os_version].filter(Boolean).join(" ")} · ${fp.source}`,
        `Network: ${fp.isp || "?"}`,
      ],
    })
  );

  return json({ ok: true }, 200, { "Set-Cookie": visitorCookie(visitorId) });
}

// ---------- admin API ----------

async function adminLogin(request, env) {
  const { password } = await request.json().catch(() => ({}));
  if (!password || !(await verifyPassword(password, env.ADMIN_PASSWORD_HASH))) {
    // Small constant delay to blunt brute forcing.
    await new Promise((r) => setTimeout(r, 400));
    return json({ ok: false }, 401);
  }
  const token = await createSession(env.SESSION_SECRET);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token) });
}

async function adminMessages(request, env) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
  const before = parseInt(url.searchParams.get("before") || "0", 10);

  const where = [];
  const args = [];
  if (slug !== null) { where.push("m.slug = ?"); args.push(slug); }
  if (before) { where.push("m.id < ?"); args.push(before); }
  const clause = where.length ? "WHERE " + where.join(" AND ") : "";

  const rows = await env.DB.prepare(
    `SELECT m.id, m.slug, m.body, m.is_read, m.created_at, m.visitor_id,
            v.handle, v.label,
            e.city, e.region, e.country, e.isp, e.asn, e.ip, e.source,
            e.os, e.os_version, e.device_model, e.browser, e.browser_version,
            e.device, e.timezone, e.lat, e.lon,
            (SELECT COUNT(*) FROM messages mm WHERE mm.visitor_id = m.visitor_id) AS sender_messages,
            (SELECT COUNT(*) FROM events ev WHERE ev.visitor_id = m.visitor_id AND ev.type='view') AS sender_views
     FROM messages m
     LEFT JOIN visitors v ON v.id = m.visitor_id
     LEFT JOIN events e ON e.id = m.event_id
     ${clause}
     ORDER BY m.id DESC LIMIT ?`
  ).bind(...args, limit).all();

  return json({ ok: true, messages: rows.results });
}

async function adminVisitor(request, env, visitorId) {
  const visitor = await env.DB.prepare("SELECT * FROM visitors WHERE id = ?").bind(visitorId).first();
  if (!visitor) return json({ ok: false }, 404);
  const messages = await env.DB.prepare(
    "SELECT id, slug, body, created_at FROM messages WHERE visitor_id = ? ORDER BY id DESC"
  ).bind(visitorId).all();
  const events = await env.DB.prepare(
    `SELECT type, city, region, country, isp, asn, ip, source, os, os_version,
            device_model, browser, browser_version, device, lang, screen, timezone,
            lat, lon, created_at
     FROM events WHERE visitor_id = ? ORDER BY id DESC LIMIT 100`
  ).bind(visitorId).all();
  return json({ ok: true, visitor, messages: messages.results, events: events.results });
}

async function adminStats(env) {
  const totals = await env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM messages) AS messages,
      (SELECT COUNT(*) FROM events WHERE type='view') AS views,
      (SELECT COUNT(DISTINCT visitor_id) FROM visitors) AS visitors,
      (SELECT COUNT(*) FROM messages WHERE is_read=0) AS unread`
  ).first();
  return json({ ok: true, stats: totals });
}

async function adminLinks(request, env) {
  if (request.method === "POST") {
    const { slug, title, prompt } = await request.json().catch(() => ({}));
    const clean = (slug || "").toString().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
    if (!clean) return json({ ok: false, error: "invalid_slug" }, 400);
    await env.DB.prepare(
      "INSERT OR IGNORE INTO links (slug, title, prompt, created_at, active) VALUES (?,?,?,?,1)"
    ).bind(clean, (title || clean).toString().slice(0, 80), (prompt || "send me a message!").toString().slice(0, 200), Date.now()).run();
    return json({ ok: true, slug: clean });
  }
  const rows = await env.DB.prepare(
    `SELECT l.*, (SELECT COUNT(*) FROM messages m WHERE m.slug = l.slug) AS messages,
            (SELECT COUNT(*) FROM events e WHERE e.slug = l.slug AND e.type='view') AS views
     FROM links l ORDER BY l.created_at DESC`
  ).all();
  return json({ ok: true, links: rows.results });
}

async function adminMarkRead(env, id) {
  await env.DB.prepare("UPDATE messages SET is_read = 1 WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
async function adminDeleteMessage(env, id) {
  await env.DB.prepare("DELETE FROM messages WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

// ---------- router ----------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Public capture endpoints
      if (path === "/api/view" && request.method === "POST") return handleView(request, env, ctx);
      if (path === "/api/send" && request.method === "POST") return handleSend(request, env, ctx);

      // Link metadata for the send page (title/prompt/handle)
      if (path === "/api/link" && request.method === "GET") {
        const slug = url.searchParams.get("slug") || "";
        const link = await env.DB.prepare("SELECT slug, title, prompt, active FROM links WHERE slug = ?").bind(slug).first();
        return json({ ok: true, owner: env.OWNER_HANDLE || "", link: link || null });
      }

      // Admin auth
      if (path === "/api/admin/login" && request.method === "POST") return adminLogin(request, env);
      if (path === "/api/admin/logout" && request.method === "POST")
        return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie });
      if (path === "/api/admin/me") return json({ ok: true, authed: await requireAdmin(request, env) });

      // Everything below requires admin
      if (path.startsWith("/api/admin/")) {
        if (!(await requireAdmin(request, env))) return json({ ok: false, error: "unauthorized" }, 401);

        if (path === "/api/admin/messages") return adminMessages(request, env);
        if (path === "/api/admin/stats") return adminStats(env);
        if (path === "/api/admin/links") return adminLinks(request, env);
        if (path === "/api/admin/visitors" ) {
          const rows = await env.DB.prepare(
            `SELECT v.id, v.handle, v.label, v.first_seen, v.last_seen,
                    (SELECT COUNT(*) FROM messages m WHERE m.visitor_id=v.id) AS messages,
                    (SELECT COUNT(*) FROM events e WHERE e.visitor_id=v.id AND e.type='view') AS views,
                    (SELECT city||', '||country FROM events e WHERE e.visitor_id=v.id ORDER BY e.id DESC LIMIT 1) AS last_loc
             FROM visitors v
             WHERE (SELECT COUNT(*) FROM messages m WHERE m.visitor_id=v.id) > 0
                OR (SELECT COUNT(*) FROM events e WHERE e.visitor_id=v.id) > 0
             ORDER BY v.last_seen DESC LIMIT 200`
          ).all();
          return json({ ok: true, visitors: rows.results });
        }
        let m;
        if ((m = path.match(/^\/api\/admin\/visitor\/(.+)$/))) return adminVisitor(request, env, m[1]);
        if ((m = path.match(/^\/api\/admin\/message\/(\d+)\/read$/)) && request.method === "POST")
          return adminMarkRead(env, parseInt(m[1], 10));
        if ((m = path.match(/^\/api\/admin\/message\/(\d+)$/)) && request.method === "DELETE")
          return adminDeleteMessage(env, parseInt(m[1], 10));

        return json({ ok: false, error: "not_found" }, 404);
      }

      // Serve the admin dashboard shell (auth happens client-side via /api/admin/me)
      if (path === "/admin" || path === "/admin/") {
        return env.ASSETS.fetch(new Request(new URL("/admin.html", url), request));
      }

      // Anything else → static assets (SPA fallback serves the send page)
      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ ok: false, error: "server_error", detail: String(err && err.message || err) }, 500);
    }
  },
};
