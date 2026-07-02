// Builds a consensual fingerprint snapshot from a request + client hints.
// Everything is derived from headers/`request.cf`/`navigator` values the
// browser already exposes — no covert access. Location is IP-level (city/ISP),
// not GPS. iPhone model is inferred from viewport size (Apple hides it in UA).

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
  for (const app of IN_APP) if (app.re.test(ua)) return app.name;
  if (/CriOS|Chrome/i.test(ua)) return "Chrome";
  if (/EdgiOS|Edg\//i.test(ua)) return "Edge";
  if (/FxiOS|Firefox/i.test(ua)) return "Firefox";
  if (/SamsungBrowser/i.test(ua)) return "Samsung Internet";
  if (/OPR|Opera/i.test(ua)) return "Opera";
  if (/Safari/i.test(ua)) return "Safari";
  return "Web Browser";
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

// iPhone model lookup by portrait CSS viewport (w x h) + devicePixelRatio.
// Some sizes map to several models — we return the representative range.
const IPHONE_TABLE = [
  { w: 320, h: 568, dpr: 2, name: "iPhone SE (1st gen)" },
  { w: 375, h: 667, dpr: 2, name: "iPhone SE (2nd/3rd gen)" },
  { w: 414, h: 736, dpr: 3, name: "iPhone 8 Plus" },
  { w: 375, h: 812, dpr: 3, name: "iPhone X / XS / 11 Pro" },
  { w: 414, h: 896, dpr: 2, name: "iPhone XR / 11" },
  { w: 414, h: 896, dpr: 3, name: "iPhone XS Max / 11 Pro Max" },
  { w: 360, h: 780, dpr: 3, name: "iPhone 12 mini / 13 mini" },
  { w: 375, h: 812, dpr: 3, name: "iPhone 12 mini / 13 mini" },
  { w: 390, h: 844, dpr: 3, name: "iPhone 12 / 13 / 14" },
  { w: 428, h: 926, dpr: 3, name: "iPhone 12/13 Pro Max / 14 Plus" },
  { w: 393, h: 852, dpr: 3, name: "iPhone 14 Pro / 15 / 15 Pro / 16" },
  { w: 430, h: 932, dpr: 3, name: "iPhone 15 Plus / 15 Pro Max / 16 Plus" },
  { w: 402, h: 874, dpr: 3, name: "iPhone 16 Pro" },
  { w: 440, h: 956, dpr: 3, name: "iPhone 16 Pro Max" },
];

function iphoneFromViewport(vw, vh, dpr) {
  if (!vw || !vh) return "";
  const w = Math.min(vw, vh), h = Math.max(vw, vh);
  const near = (a, b) => Math.abs(a - b) <= 3;
  const drp = Math.round(dpr || 0);
  let best = "";
  for (const m of IPHONE_TABLE) {
    if (near(w, m.w) && near(h, m.h) && (drp === 0 || drp === m.dpr)) return m.name;
    if (!best && near(w, m.w) && near(h, m.h)) best = m.name;
  }
  return best || "iPhone";
}

// Android UA embeds the model, e.g. "...; SM-S911B Build/..." or "...; Pixel 8)".
function androidModel(ua) {
  let m = ua.match(/;\s*([^;)]+?)\s+Build\//i);
  if (m) return m[1].trim();
  m = ua.match(/;\s*([^;)]+)\)/);
  if (m && !/Android|Linux|U;|wv/i.test(m[1])) return m[1].trim();
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

export async function buildFingerprint(request, hints = {}) {
  const ua = request.headers.get("User-Agent") || "";
  const cf = request.cf || {};
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const lang = request.headers.get("Accept-Language") || "";
  const referer = request.headers.get("Referer") || "";

  const { browser, version } = detectBrowser(ua);
  const os = detectOS(ua);

  // Resolve device model: UA high-entropy > Android UA > iPhone-from-viewport.
  let device_model = "", model_source = "";
  if (hints.model) { device_model = hints.model; model_source = "ua"; }
  else if (/Android/i.test(ua)) { device_model = androidModel(ua); model_source = device_model ? "ua" : ""; }
  else if (/iPhone/i.test(ua)) {
    device_model = iphoneFromViewport(hints.vw, hints.vh, hints.dpr);
    model_source = device_model && device_model !== "iPhone" ? "viewport" : "";
  } else if (/iPad/i.test(ua)) { device_model = "iPad"; }

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
    device_model,
    model_source,
    source: detectSource(ua),
    is_mobile: /Mobi|Android|iPhone/i.test(ua) ? 1 : 0,
    lang: (hints.langs || lang).split(",")[0] || "",
    referer,
    viewport: hints.vw && hints.vh ? `${hints.vw}x${hints.vh}` : "",
    screen: hints.screen || "",
    dpr: hints.dpr ? String(hints.dpr) : "",
    platform: hints.platform || "",
    cores: hints.cores || null,
    mem: hints.mem ? String(hints.mem) : "",
    touch: hints.touch != null ? Number(hints.touch) : null,
    color_depth: hints.colorDepth || null,
  };

  // ip+ua fallback identity.
  fp.fp_hash = await sha256Hex([ip, ua, fp.lang, fp.timezone].join("|"));
  // Device fingerprint — stable across IP/WiFi changes (no IP in it).
  fp.device_fp = await sha256Hex(
    [ua, fp.viewport, fp.screen, fp.dpr, fp.platform, fp.cores, fp.mem, fp.touch, fp.color_depth, fp.timezone, fp.lang].join("|")
  );
  return fp;
}
