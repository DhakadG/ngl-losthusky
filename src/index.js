import { buildFingerprint } from "./lib/fingerprint.js";
import { verifyPassword, createSession, verifySession, parseCookies } from "./lib/auth.js";
import { notify, buildReport } from "./lib/notify.js";

const MAX_MSG_LEN = 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 8;

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });

const uuid = () => crypto.randomUUID();

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

// Resolve a stable sender identity across IP/WiFi changes.
// Priority: cookie vid > client-stored id (localStorage) > device fingerprint > new.
async function resolveVisitor(env, request, fp, body = {}) {
  const cookies = parseCookies(request);
  let id = cookies.vid || (body.clientId || "").toString().slice(0, 40);
  const now = Date.now();

  if (!id && fp.device_fp) {
    const found = await env.DB.prepare("SELECT id FROM visitors WHERE device_fp = ? ORDER BY last_seen DESC LIMIT 1").bind(fp.device_fp).first();
    if (found) id = found.id;
  }
  if (!id && fp.fp_hash) {
    const found = await env.DB.prepare("SELECT id FROM visitors WHERE fp_hash = ? ORDER BY last_seen DESC LIMIT 1").bind(fp.fp_hash).first();
    if (found) id = found.id;
  }
  if (!id) id = uuid();

  await env.DB.prepare(
    `INSERT INTO visitors (id, device_fp, fp_hash, first_seen, last_seen)
     VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT(id) DO UPDATE SET last_seen = ?4, device_fp = ?2, fp_hash = ?3`,
  )
    .bind(id, fp.device_fp, fp.fp_hash, now)
    .run();

  return { id };
}

async function insertEvent(env, type, slug, visitorId, fp) {
  const now = Date.now();
  const r = await env.DB.prepare(
    `INSERT INTO events (type, slug, visitor_id, device_fp, fp_hash, ip, country, region, city,
      lat, lon, timezone, postal, asn, isp, colo, ua, browser, browser_version,
      os, os_version, device, device_model, model_source, source, is_mobile, lang, referer,
      viewport, screen, dpr, platform, cores, mem, touch, color_depth, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      type,
      slug,
      visitorId,
      fp.device_fp,
      fp.fp_hash,
      fp.ip,
      fp.country,
      fp.region,
      fp.city,
      fp.lat,
      fp.lon,
      fp.timezone,
      fp.postal,
      fp.asn,
      fp.isp,
      fp.colo,
      fp.ua,
      fp.browser,
      fp.browser_version,
      fp.os,
      fp.os_version,
      fp.device,
      fp.device_model,
      fp.model_source,
      fp.source,
      fp.is_mobile,
      fp.lang,
      fp.referer,
      fp.viewport,
      fp.screen,
      fp.dpr,
      fp.platform,
      fp.cores,
      fp.mem,
      fp.touch,
      fp.color_depth,
      now,
    )
    .run();
  return r.meta.last_row_id;
}

async function visitorCounts(env, visitorId) {
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM messages WHERE visitor_id = ?1) AS msgs,
            (SELECT COUNT(*) FROM events WHERE visitor_id = ?1 AND type = 'view') AS views`,
  )
    .bind(visitorId)
    .first();
  return { msgs: row?.msgs || 0, views: row?.views || 0 };
}

// Admin-configurable notification settings (persisted in D1).
const SETTING_DEFAULTS = {
  notify_messages: "1", // notify on new messages
  notify_views: "1", // notify on link views
  skip_bot_views: "1", // suppress view notifs from hosting/VPN/proxy networks
  skip_bot_messages: "0", // suppress message notifs from hosting/VPN/proxy networks
};
async function getSettings(env) {
  const s = { ...SETTING_DEFAULTS };
  try {
    const rows = await env.DB.prepare("SELECT key, value FROM settings").all();
    for (const r of rows.results) if (r.key in s) s[r.key] = String(r.value);
  } catch {}
  return s;
}
// Decide whether to send a notification for this event given settings + bot-ness.
function shouldNotify(kind, fp, settings) {
  if (kind === "view" && settings.notify_views !== "1") return false;
  if (kind === "message" && settings.notify_messages !== "1") return false;
  if (kind === "view" && settings.skip_bot_views === "1" && fp.is_hosting) return false;
  if (kind === "message" && settings.skip_bot_messages === "1" && fp.is_hosting) return false;
  return true;
}

// ---------- public API ----------

async function handleView(request, env, ctx) {
  const hints = await request.json().catch(() => ({}));
  const slug = (hints.slug || "").toString().slice(0, 40);
  const fp = await buildFingerprint(request, hints);
  const { id: visitorId } = await resolveVisitor(env, request, fp, hints);
  await insertEvent(env, "view", slug, visitorId, fp);

  const settings = await getSettings(env);
  if (shouldNotify("view", fp, settings)) {
    ctx.waitUntil(
      (async () => {
        const counts = await visitorCounts(env, visitorId);
        const report = buildReport("view", fp, {
          slug,
          senderMessages: counts.msgs,
          senderViews: counts.views,
          dashboardUrl: `${new URL(request.url).origin}/admin#v=${encodeURIComponent(visitorId)}`,
        });
        await notify(env, report);
      })(),
    );
  }
  return json({ ok: true, visitorId }, 200, { "Set-Cookie": visitorCookie(visitorId) });
}

async function handleSend(request, env, ctx) {
  const body = await request.json().catch(() => ({}));
  const slug = (body.slug || "").toString().slice(0, 40);
  const message = (body.message || "").toString().trim();
  const handle = (body.handle || "").toString().trim().replace(/^@/, "").slice(0, 60);

  if (!message) return json({ ok: false, error: "empty" }, 400);
  if (message.length > MAX_MSG_LEN) return json({ ok: false, error: "too_long" }, 400);

  const fp = await buildFingerprint(request, body);
  const { id: visitorId } = await resolveVisitor(env, request, fp, body);

  const since = Date.now() - RATE_WINDOW_MS;
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM messages WHERE created_at > ? AND (visitor_id = ? OR event_id IN (SELECT id FROM events WHERE ip = ? AND created_at > ?))")
    .bind(since, visitorId, fp.ip, since)
    .first();
  if (recent && recent.n >= RATE_MAX) return json({ ok: false, error: "rate_limited" }, 429);

  if (handle) await env.DB.prepare("UPDATE visitors SET handle = ? WHERE id = ?").bind(handle, visitorId).run();

  const eventId = await insertEvent(env, "message", slug, visitorId, fp);
  await env.DB.prepare("INSERT INTO messages (slug, visitor_id, body, event_id, created_at) VALUES (?,?,?,?,?)").bind(slug, visitorId, message, eventId, Date.now()).run();

  const settings = await getSettings(env);
  if (shouldNotify("message", fp, settings)) {
    ctx.waitUntil(
      (async () => {
        const counts = await visitorCounts(env, visitorId);
        const report = buildReport("message", fp, {
          slug,
          handle,
          message,
          senderMessages: counts.msgs,
          senderViews: counts.views,
          dashboardUrl: `${new URL(request.url).origin}/admin#v=${encodeURIComponent(visitorId)}`,
        });
        await notify(env, report);
      })(),
    );
  }

  return json({ ok: true }, 200, { "Set-Cookie": visitorCookie(visitorId) });
}

// ---------- admin API ----------

async function adminLogin(request, env) {
  const { password } = await request.json().catch(() => ({}));
  if (!password || !(await verifyPassword(password, env.ADMIN_PASSWORD_HASH))) {
    await new Promise((r) => setTimeout(r, 400));
    return json({ ok: false }, 401);
  }
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(await createSession(env.SESSION_SECRET)) });
}

async function adminMessages(request, env) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "60", 10), 200);
  const before = parseInt(url.searchParams.get("before") || "0", 10);

  const where = [],
    args = [];
  if (slug !== null) {
    where.push("m.slug = ?");
    args.push(slug);
  }
  if (before) {
    where.push("m.id < ?");
    args.push(before);
  }
  const clause = where.length ? "WHERE " + where.join(" AND ") : "";

  const rows = await env.DB.prepare(
    `SELECT m.id, m.slug, m.body, m.is_read, m.created_at, m.visitor_id,
            v.handle, v.label,
            e.city, e.region, e.country, e.isp, e.asn, e.ip, e.source,
            e.os, e.os_version, e.device_model, e.model_source, e.browser, e.browser_version,
            e.device, e.timezone, e.lat, e.lon,
            (SELECT COUNT(*) FROM messages mm WHERE mm.visitor_id = m.visitor_id) AS sender_messages,
            (SELECT COUNT(*) FROM events ev WHERE ev.visitor_id = m.visitor_id AND ev.type='view') AS sender_views
     FROM messages m
     LEFT JOIN visitors v ON v.id = m.visitor_id
     LEFT JOIN events e ON e.id = m.event_id
     ${clause}
     ORDER BY m.id DESC LIMIT ?`,
  )
    .bind(...args, limit)
    .all();
  return json({ ok: true, messages: rows.results });
}

async function adminVisitor(env, visitorId) {
  const visitor = await env.DB.prepare("SELECT * FROM visitors WHERE id = ?").bind(visitorId).first();
  if (!visitor) return json({ ok: false }, 404);
  const messages = await env.DB.prepare("SELECT id, slug, body, created_at FROM messages WHERE visitor_id = ? ORDER BY id DESC").bind(visitorId).all();
  const events = await env.DB.prepare(
    `SELECT type, city, region, country, isp, asn, ip, source, os, os_version,
            device_model, model_source, browser, browser_version, device, lang, viewport,
            screen, dpr, platform, cores, mem, touch, color_depth, timezone, lat, lon, created_at
     FROM events WHERE visitor_id = ? ORDER BY id DESC LIMIT 100`,
  )
    .bind(visitorId)
    .all();
  return json({ ok: true, visitor, messages: messages.results, events: events.results });
}

async function adminStats(env) {
  const totals = await env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM messages) AS messages,
      (SELECT COUNT(*) FROM events WHERE type='view') AS views,
      (SELECT COUNT(DISTINCT id) FROM visitors) AS visitors,
      (SELECT COUNT(*) FROM messages WHERE is_read=0) AS unread`,
  ).first();
  return json({ ok: true, stats: totals });
}

async function adminLinks(request, env) {
  if (request.method === "POST") {
    const { slug, title, prompt } = await request.json().catch(() => ({}));
    const clean = (slug || "")
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "")
      .slice(0, 40);
    if (!clean) return json({ ok: false, error: "invalid_slug" }, 400);
    await env.DB.prepare("INSERT OR IGNORE INTO links (slug, title, prompt, created_at, active) VALUES (?,?,?,?,1)")
      .bind(clean, (title || clean).toString().slice(0, 80), (prompt || "send me anonymous messages!").toString().slice(0, 200), Date.now())
      .run();
    return json({ ok: true, slug: clean });
  }
  const rows = await env.DB.prepare(
    `SELECT l.*, (SELECT COUNT(*) FROM messages m WHERE m.slug = l.slug) AS messages,
            (SELECT COUNT(*) FROM events e WHERE e.slug = l.slug AND e.type='view') AS views
     FROM links l ORDER BY l.created_at DESC`,
  ).all();
  return json({ ok: true, links: rows.results });
}

async function adminSettings(request, env) {
  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    for (const k of Object.keys(SETTING_DEFAULTS)) {
      if (k in body) {
        await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2")
          .bind(k, body[k] ? "1" : "0")
          .run();
      }
    }
  }
  return json({ ok: true, settings: await getSettings(env) });
}

async function adminVisitors(env) {
  const rows = await env.DB.prepare(
    `SELECT v.id, v.handle, v.label, v.first_seen, v.last_seen,
            (SELECT COUNT(*) FROM messages m WHERE m.visitor_id=v.id) AS messages,
            (SELECT COUNT(*) FROM events e WHERE e.visitor_id=v.id AND e.type='view') AS views,
            (SELECT city||', '||country FROM events e WHERE e.visitor_id=v.id ORDER BY e.id DESC LIMIT 1) AS last_loc,
            (SELECT device_model FROM events e WHERE e.visitor_id=v.id AND e.device_model<>'' ORDER BY e.id DESC LIMIT 1) AS device_model
     FROM visitors v
     WHERE EXISTS (SELECT 1 FROM events e WHERE e.visitor_id=v.id)
     ORDER BY v.last_seen DESC LIMIT 300`,
  ).all();
  return json({ ok: true, visitors: rows.results });
}

// ---------- router ----------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === "/api/view" && request.method === "POST") return handleView(request, env, ctx);
      if (path === "/api/send" && request.method === "POST") return handleSend(request, env, ctx);

      if (path === "/api/link" && request.method === "GET") {
        const slug = url.searchParams.get("slug") || "";
        const link = await env.DB.prepare("SELECT slug, title, prompt, active FROM links WHERE slug = ?").bind(slug).first();
        const c = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM events WHERE slug=?1 AND type='view') AS views, (SELECT COUNT(*) FROM messages WHERE slug=?1) AS messages").bind(slug).first();
        return json({ ok: true, owner: env.OWNER_HANDLE || "", link: link || null, views: c?.views || 0, messages: c?.messages || 0 });
      }

      if (path === "/api/admin/login" && request.method === "POST") return adminLogin(request, env);
      if (path === "/api/admin/logout" && request.method === "POST") return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie });
      if (path === "/api/admin/me") return json({ ok: true, authed: await requireAdmin(request, env) });

      if (path.startsWith("/api/admin/")) {
        if (!(await requireAdmin(request, env))) return json({ ok: false, error: "unauthorized" }, 401);
        if (path === "/api/admin/messages") return adminMessages(request, env);
        if (path === "/api/admin/stats") return adminStats(env);
        if (path === "/api/admin/links") return adminLinks(request, env);
        if (path === "/api/admin/visitors") return adminVisitors(env);
        if (path === "/api/admin/settings") return adminSettings(request, env);
        let m;
        if ((m = path.match(/^\/api\/admin\/visitor\/(.+)$/))) return adminVisitor(env, decodeURIComponent(m[1]));
        if ((m = path.match(/^\/api\/admin\/message\/(\d+)\/read$/)) && request.method === "POST") {
          await env.DB.prepare("UPDATE messages SET is_read=1 WHERE id=?").bind(parseInt(m[1], 10)).run();
          return json({ ok: true });
        }
        if ((m = path.match(/^\/api\/admin\/message\/(\d+)$/)) && request.method === "DELETE") {
          await env.DB.prepare("DELETE FROM messages WHERE id=?").bind(parseInt(m[1], 10)).run();
          return json({ ok: true });
        }
        return json({ ok: false, error: "not_found" }, 404);
      }

      // /admin is intentionally NOT special-cased here — the assets layer's
      // own clean-URL resolution serves admin.html for it directly. See the
      // run_worker_first comment in wrangler.jsonc for why.
      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ ok: false, error: "server_error", detail: String((err && err.message) || err) }, 500);
    }
  },
};
