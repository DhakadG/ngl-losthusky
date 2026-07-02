// Builds a consensual fingerprint snapshot from a request.
// Everything here is derived from headers/`request.cf` the browser already
// sends — no covert access to the device. Location is IP-level (city/ISP),
// not GPS. Device model is only available on Android (Apple strips it on iOS).

const IN_APP = [
  { re: /Instagram/i, name: "Instagram" },
  { re: /FBAN|FBAV|FB_IAB|FBIOS/i, name: "Facebook" },
  { re: /Snapchat/i, name: "Snapchat" },
  { re: /(musical_ly|BytedanceWebview|TikTok)/i, name: "TikTok" },
  { re: /Twitter/i, name: "Twitter/X" },
  { re: /LinkedInApp/i, name: "LinkedIn" },
  { re: /WhatsApp/i, name: "WhatsApp" },
  { re: /Telegram/i, name: "Telegram" },
  { re: /Line\//i, name: "LINE" },
  { re: /Pinterest/i, name: "Pinterest" },
  { re: /Discord/i, name: "Discord" },
];

function detectSource(ua) {
  for (const app of IN_APP) if (app.re.test(ua)) return app.name + " in-app browser";
  if (/CriOS/i.test(ua)) return "Chrome (iOS)";
  if (/EdgiOS|Edg\//i.test(ua)) return "Edge";
  if (/FxiOS|Firefox/i.test(ua)) return "Firefox";
  if (/SamsungBrowser/i.test(ua)) return "Samsung Internet";
  if (/OPR|Opera/i.test(ua)) return "Opera";
  if (/Chrome/i.test(ua)) return "Chrome";
  if (/Safari/i.test(ua)) return "Safari";
  return "Web browser";
}

function detectBrowser(ua) {
  const pick = (re) => (ua.match(re) || [])[1] || "";
  if (/SamsungBrowser/i.test(ua)) return { browser: "Samsung Internet", version: pick(/SamsungBrowser\/([\d.]+)/) };
  if (/EdgiOS|Edg/i.test(ua)) return { browser: "Edge", version: pick(/Edg(?:iOS)?\/([\d.]+)/) };
  if (/OPR|Opera/i.test(ua)) return { browser: "Opera", version: pick(/(?:OPR|Opera)\/([\d.]+)/) };
  if (/CriOS/i.test(ua)) return { browser: "Chrome", version: pick(/CriOS\/([\d.]+)/) };
  if (/FxiOS|Firefox/i.test(ua)) return { browser: "Firefox", version: pick(/(?:FxiOS|Firefox)\/([\d.]+)/) };
  if (/Chrome/i.test(ua)) return { browser: "Chrome", version: pick(/Chrome\/([\d.]+)/) };
  if (/Version\/[\d.]+.*Safari/i.test(ua)) return { browser: "Safari", version: pick(/Version\/([\d.]+)/) };
  return { browser: "Unknown", version: "" };
}

function detectOS(ua) {
  let m;
  if ((m = ua.match(/Android\s+([\d.]+)/i))) return { os: "Android", os_version: m[1] };
  if ((m = ua.match(/(?:iPhone|iPad|iPod).*?OS\s+(\d+[_\d]*)/i)))
    return { os: /iPad/i.test(ua) ? "iPadOS" : "iOS", os_version: m[1].replace(/_/g, ".") };
  if ((m = ua.match(/Windows NT\s+([\d.]+)/i))) {
    const map = { "10.0": "10/11", "6.3": "8.1", "6.2": "8", "6.1": "7" };
    return { os: "Windows", os_version: map[m[1]] || m[1] };
  }
  if ((m = ua.match(/Mac OS X\s+([\d_]+)/i))) return { os: "macOS", os_version: m[1].replace(/_/g, ".") };
  if (/Linux/i.test(ua)) return { os: "Linux", os_version: "" };
  return { os: "Unknown", os_version: "" };
}

// Android UA embeds the model, e.g. "...; SM-S911B Build/..." or "...; Pixel 8)".
function detectDeviceModel(ua, hints) {
  if (hints && hints.model) return hints.model;
  let m = ua.match(/;\s*([^;)]+?)\s+Build\//i);
  if (m) return m[1].trim();
  if (/Android/i.test(ua)) {
    m = ua.match(/;\s*([^;)]+)\)/);
    if (m && !/Android/i.test(m[1])) return m[1].trim();
  }
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  return "";
}

function deviceType(ua) {
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/Mobi|Android.*Mobile|iPhone/i.test(ua)) return "mobile";
  return "desktop";
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// hints: optional client-hint object from the browser { model, screen, tz, ... }
export async function buildFingerprint(request, hints = {}) {
  const ua = request.headers.get("User-Agent") || "";
  const cf = request.cf || {};
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const lang = request.headers.get("Accept-Language") || "";
  const referer = request.headers.get("Referer") || "";

  const { browser, version } = detectBrowser(ua);
  const os = detectOS(ua);
  const fp = {
    ip,
    country: cf.country || "",
    region: cf.region || "",
    city: cf.city || "",
    lat: cf.latitude ? Number(cf.latitude) : null,
    lon: cf.longitude ? Number(cf.longitude) : null,
    timezone: cf.timezone || hints.tz || "",
    postal: cf.postalCode || "",
    asn: cf.asn || null,
    isp: cf.asOrganization || "",
    colo: cf.colo || "",
    ua,
    browser,
    browser_version: version,
    os: os.os,
    os_version: os.os_version,
    device: deviceType(ua),
    device_model: detectDeviceModel(ua, hints),
    source: detectSource(ua),
    is_mobile: /Mobi|Android|iPhone/i.test(ua) ? 1 : 0,
    lang: lang.split(",")[0] || "",
    referer,
    screen: hints.screen || "",
  };
  // Server-side fallback identity (used only if the cookie is missing/cleared).
  fp.fp_hash = await sha256Hex([ip, ua, fp.lang, fp.timezone].join("|"));
  return fp;
}
