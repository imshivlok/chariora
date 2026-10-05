/* Chariora extension: pure helpers shared by the popup, service worker and content script.
 * Plain script (no modules) so it can be loaded everywhere; also importable from Node for tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ChariCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  const DEFAULTS = { autoCheck: true, apiBase: "http://localhost:8787", webBase: "http://localhost:5173" };
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;
  const KEYWORDS = ["donate", "donation", "charity", "fundraiser", "fundraising", "relief"];

  /** Strip trailing slashes and make sure it is an http(s) URL. Returns null when invalid. */
  function cleanBase(value) {
    try {
      const u = new URL(String(value).trim());
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return (u.origin + u.pathname).replace(/\/+$/, "");
    } catch (e) { return null; }
  }

  function isPrivateHost(host) {
    const h = host.toLowerCase().replace(/^\[|\]$/g, "");
    if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.includes(":")) return true;
    const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (m) {
      const a = Number(m[1]), b = Number(m[2]);
      return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
    }
    return !h.includes(".");
  }

  /** Only public http(s) pages can be checked (not chrome://, file://, localhost, IPs on a LAN). */
  function isCheckableUrl(url) {
    try {
      const u = new URL(url);
      return (u.protocol === "http:" || u.protocol === "https:") && !isPrivateHost(u.hostname);
    } catch (e) { return false; }
  }

  /** What we send to the backend: the site origin only. Paths and query strings never leave the browser. */
  function targetFor(url) { return new URL(url).origin; }

  /** Cache key per site, ignoring "www.". */
  function cacheKey(url) { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }

  function isFresh(entry, now, ttl) {
    return !!entry && typeof entry.at === "number" && (now || Date.now()) - entry.at < (ttl || CACHE_TTL_MS);
  }

  /**
   * Does the page look like a donation page? Scores keyword hits by where they appear
   * (address and title count more than headings or buttons). Threshold 2 keeps ordinary pages quiet.
   * input: { url, title, headings: string[], buttons: string[] }
   */
  function donationScore(input) {
    const has = (text) => KEYWORDS.some((k) => String(text || "").toLowerCase().includes(k));
    let score = 0;
    try {
      const u = new URL(input.url);
      if (has(u.hostname)) score += 2;
      else if (has(u.pathname)) score += 2;
    } catch (e) { /* ignore */ }
    if (has(input.title)) score += 1;
    if ((input.headings || []).some(has)) score += 1;
    if ((input.buttons || []).some((b) => /\b(donate|give now|give today|support (us|the cause)|contribute)\b/i.test(b || ""))) score += 1;
    return score;
  }
  const looksLikeDonationPage = (input) => donationScore(input) >= 2;

  /** "good" | "warn" | "bad" from a verdict string. */
  function verdictTone(verdict) {
    if (verdict === "Verified Charity" || verdict === "Likely Legitimate") return "good";
    if (verdict === "Suspicious - Verify Before Donating") return "warn";
    return "bad";
  }
  /** Only Suspicious or worse triggers the on-page banner. */
  const shouldWarn = (result) => !!result && verdictTone(result.verdict) !== "good";
  const badgeFor = (verdict) => ({ good: { text: "OK", color: "#2b8a57" }, warn: { text: "?", color: "#d99a00" }, bad: { text: "!", color: "#c8402f" } })[verdictTone(verdict)];

  function buildReportUrl(webBase, target) {
    const base = cleanBase(webBase) || DEFAULTS.webBase;
    return base + "/check?target=" + encodeURIComponent(target);
  }

  /** Keep only what the extension needs; the full report is on the web app. */
  function slimResult(r) {
    return { verdict: r.verdict, score: r.score, confidence: r.confidence, source: r.source, normalizedDomain: r.normalizedDomain || null, registry: r.registry && r.registry.found ? { id: r.registry.id || null, name: r.registry.name || null } : null, checkedAt: r.checkedAt };
  }

  /** Needle angle in degrees for the mini gauge: -90 (left) to +90 (right). */
  const needleAngle = (score) => (Math.max(0, Math.min(100, score)) / 100) * 180 - 90;

  return { DEFAULTS, CACHE_TTL_MS, DISMISS_TTL_MS, KEYWORDS, cleanBase, isPrivateHost, isCheckableUrl, targetFor, cacheKey, isFresh, donationScore, looksLikeDonationPage, verdictTone, shouldWarn, badgeFor, buildReportUrl, slimResult, needleAngle };
});
