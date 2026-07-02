// Optional push notifications when a message (or view) arrives.
// Supports Telegram and any generic JSON webhook (Discord/Slack compatible).
// All are opt-in via secrets; if none are set, this is a no-op.

export async function notify(env, { title, lines }) {
  const text = `${title}\n` + lines.filter(Boolean).join("\n");
  const jobs = [];

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    jobs.push(
      fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
      }).catch(() => {})
    );
  }

  if (env.NOTIFY_WEBHOOK_URL) {
    // `content` works for Discord; generic receivers still get title/text/lines.
    jobs.push(
      fetch(env.NOTIFY_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, title, text, lines }),
      }).catch(() => {})
    );
  }

  await Promise.allSettled(jobs);
}
