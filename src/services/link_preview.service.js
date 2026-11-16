const dns = require("dns").promises;
const net = require("net");

const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const FETCH_TIMEOUT_MS = 4500;
const MAX_HTML_BYTES = 512 * 1024;

const previewCache = new Map();

function isPrivateIpAddress(ip) {
  if (!ip) return true;
  const clean = ip.replace(/^::ffff:/i, "").toLowerCase();

  if (clean === "::1" || clean === "::") return true;
  if (clean.startsWith("fe80:") || clean.startsWith("fc") || clean.startsWith("fd")) {
    return true;
  }

  if (net.isIPv4(clean)) {
    const parts = clean.split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  return false;
}

async function assertSafePublicHttpUrl(rawUrl) {
  const parsed = new URL(String(rawUrl || "").trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Unsupported protocol");
  }

  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error("Blocked local hostname");
  }

  if (net.isIP(host)) {
    if (isPrivateIpAddress(host)) {
      throw new Error("Blocked private IP");
    }
    return parsed;
  }

  try {
    const addresses = await dns.lookup(host, { all: true });
    if (Array.isArray(addresses) && addresses.some((a) => isPrivateIpAddress(a.address))) {
      throw new Error("Resolved to private IP");
    }
  } catch (err) {
    if (err.message === "Resolved to private IP") {
      throw err;
    }
    // Cho phép tiếp tục nếu DNS transient ở môi trường nội bộ/test, fetch sẽ tự timeout/fail nếu không phân giải được
  }

  return parsed;
}

function decodeHtmlEntities(input) {
  if (!input || typeof input !== "string") return "";
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTagAttribute(tagStr, attrName) {
  const regex = new RegExp(
    `\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const match = tagStr.match(regex);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : "";
}

function parseHtmlMetadata(html, baseUrl) {
  const domain = baseUrl.hostname.replace(/^www\./i, "");
  const headEnd = html.search(/<\/head>/i);
  const headHtml = headEnd !== -1 ? html.slice(0, headEnd + 7) : html.slice(0, 65536);

  const metaTags = headHtml.match(/<meta\b[^>]*>/gi) || [];
  const metaMap = new Map();

  for (const tag of metaTags) {
    const keyRaw =
      extractTagAttribute(tag, "property") ||
      extractTagAttribute(tag, "name") ||
      extractTagAttribute(tag, "itemprop");
    const contentRaw = extractTagAttribute(tag, "content");
    if (!keyRaw || !contentRaw) continue;
    const key = keyRaw.trim().toLowerCase();
    if (!metaMap.has(key)) {
      metaMap.set(key, decodeHtmlEntities(contentRaw));
    }
  }

  const titleMatch = headHtml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const htmlTitle = titleMatch ? decodeHtmlEntities(titleMatch[1]) : "";

  const title =
    metaMap.get("og:title") ||
    metaMap.get("twitter:title") ||
    metaMap.get("title") ||
    htmlTitle ||
    domain;

  const description =
    metaMap.get("og:description") ||
    metaMap.get("twitter:description") ||
    metaMap.get("description") ||
    undefined;

  const rawImage =
    metaMap.get("og:image") ||
    metaMap.get("og:image:secure_url") ||
    metaMap.get("og:image:url") ||
    metaMap.get("twitter:image") ||
    metaMap.get("twitter:image:src") ||
    "";

  let image;
  if (rawImage) {
    try {
      const resolved = new URL(rawImage, baseUrl.toString());
      if (resolved.protocol === "http:" || resolved.protocol === "https:") {
        image = resolved.toString();
      }
    } catch {
      image = undefined;
    }
  }

  const siteName = metaMap.get("og:site_name") || undefined;

  return {
    id: baseUrl.toString(),
    url: baseUrl.toString(),
    domain,
    title: title.slice(0, 220),
    ...(description ? { description: description.slice(0, 400) } : {}),
    ...(image ? { image } : {}),
    ...(siteName ? { siteName: siteName.slice(0, 120) } : {}),
  };
}

function extractYouTubeVideoId(parsedUrl) {
  const host = parsedUrl.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = parsedUrl.pathname.split("/").filter(Boolean)[0];
    return id && /^[a-zA-Z0-9_-]{6,15}$/.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    const vParam = parsedUrl.searchParams.get("v");
    if (vParam && /^[a-zA-Z0-9_-]{6,15}$/.test(vParam)) return vParam;
    const parts = parsedUrl.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && ["shorts", "live", "embed", "v"].includes(parts[0])) {
      if (/^[a-zA-Z0-9_-]{6,15}$/.test(parts[1])) return parts[1];
    }
  }
  return null;
}

async function readResponseTextBounded(response, maxBytes = MAX_HTML_BYTES) {
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    return text.slice(0, maxBytes);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      totalBytes += value.byteLength;
      chunks.push(value);
      if (totalBytes >= maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Bỏ qua lỗi huỷ stream
        }
        break;
      }
    }
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

async function fetchHtmlMeta(parsedUrl, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(parsedUrl.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; PicareHubBot/1.0; +https://hub.picare.vn)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });

    if (!response.ok) return null;
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml")
    ) {
      return null;
    }

    const finalUrl = response.url ? new URL(response.url) : parsedUrl;
    const html = await readResponseTextBounded(response);
    return parseHtmlMetadata(html, finalUrl);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchYouTubeOEmbed(videoUrl, videoId, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      videoUrl,
    )}&format=json`;
    const res = await fetch(oembedUrl, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      title: data?.title ? String(data.title).trim() : undefined,
      authorName: data?.author_name ? String(data.author_name).trim() : undefined,
      image:
        data?.thumbnail_url ||
        (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : undefined),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function setCachedPreview(url, data) {
  if (previewCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = previewCache.keys().next().value;
    if (oldestKey) previewCache.delete(oldestKey);
  }
  previewCache.set(url, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

class LinkPreviewService {
  static extractPureUrl(text) {
    if (!text || typeof text !== "string") return null;
    const trimmed = text.trim();
    if (!trimmed || /\s/.test(trimmed)) return null;
    if (!/^https?:\/\/[^\s<>"{}|\\^`[\]]+$/i.test(trimmed)) return null;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      return parsed.toString();
    } catch {
      return null;
    }
  }

  static async fetchMetadata(rawUrl, options = {}) {
    const timeoutMs = Number(options.timeoutMs) || FETCH_TIMEOUT_MS;
    const parsedUrl = await assertSafePublicHttpUrl(rawUrl);
    const canonicalUrl = parsedUrl.toString();

    const cached = previewCache.get(canonicalUrl);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const domain = parsedUrl.hostname.replace(/^www\./i, "");
    const ytId = extractYouTubeVideoId(parsedUrl);

    if (ytId) {
      const [oembedRes, htmlRes] = await Promise.allSettled([
        fetchYouTubeOEmbed(canonicalUrl, ytId, timeoutMs),
        fetchHtmlMeta(parsedUrl, timeoutMs),
      ]);
      const oembed = oembedRes.status === "fulfilled" ? oembedRes.value : null;
      const htmlMeta = htmlRes.status === "fulfilled" ? htmlRes.value : null;

      const result = {
        id: canonicalUrl,
        url: canonicalUrl,
        domain: "youtube.com",
        siteName: "YouTube",
        title: htmlMeta?.title || oembed?.title || "YouTube",
        ...(htmlMeta?.description
          ? { description: htmlMeta.description }
          : oembed?.authorName
            ? { description: `Kênh: ${oembed.authorName}` }
            : {}),
        image:
          htmlMeta?.image ||
          oembed?.image ||
          `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
      };
      setCachedPreview(canonicalUrl, result);
      return result;
    }

    const htmlMeta = await fetchHtmlMeta(parsedUrl, timeoutMs);
    const result = htmlMeta
      ? { ...htmlMeta, id: canonicalUrl, url: canonicalUrl }
      : {
          id: canonicalUrl,
          url: canonicalUrl,
          domain,
          title: domain,
        };

    setCachedPreview(canonicalUrl, result);
    return result;
  }
}

module.exports = LinkPreviewService;
