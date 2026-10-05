import * as cheerio from "cheerio";
import { parse } from "tldts";
import type { Platform, Signal, SocialProfile } from "../../../shared/types.js";
import { fetchPage, type PageFetch } from "../safeFetch.js";

const HOSTS: Record<string, Platform> = {
  "instagram.com": "instagram", "facebook.com": "facebook", "fb.com": "facebook", "fb.me": "facebook", "twitter.com": "x", "x.com": "x",
  "youtube.com": "youtube", "youtu.be": "youtube", "tiktok.com": "tiktok", "linkedin.com": "linkedin", "t.me": "telegram", "telegram.me": "telegram", "wa.me": "whatsapp", "whatsapp.com": "whatsapp",
};
const AGGREGATORS = new Set(["linktr.ee", "linktree.com", "bio.link", "beacons.ai", "lnk.bio", "carrd.co", "allmylinks.com", "campsite.bio"]);
const INFRA = new Set(["fbcdn.net", "cdninstagram.com", "twimg.com", "ytimg.com", "ggpht.com", "gstatic.com", "googleapis.com", "google.com", "googleusercontent.com", "tiktokcdn.com", "licdn.com", "apple.com", "facebook.net", "w3.org", "schema.org", "meta.com", "threads.net", "withgoogle.com"]);
const WRAP_HOSTS = new Set(["l.instagram.com", "l.facebook.com", "lm.facebook.com"]);
const STOP = new Set(["the", "of", "and", "inc", "foundation", "fund", "org", "charity", "relief", "help", "for", "usa", "american", "national", "international", "global", "society", "trust", "official"]);
export const PLATFORM_NAMES: Record<Platform, string> = { instagram: "Instagram", facebook: "Facebook", x: "X", youtube: "YouTube", tiktok: "TikTok", linkedin: "LinkedIn", telegram: "Telegram", whatsapp: "WhatsApp" };

export interface ParsedSocial { platform: Platform; handle: string; url: string; kind: "profile" | "homepage" | "post" | "share"; ytKind?: "handle" | "channel" | "user" | "custom" }

export function parseSocialUrl(href: string): ParsedSocial | null {
  let u: URL;
  try { u = new URL(href); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, "");
  const platform = HOSTS[host] ?? (host.endsWith(".youtube.com") ? "youtube" : host.endsWith(".facebook.com") ? "facebook" : undefined);
  if (!platform) return null;
  const seg = u.pathname.split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  const mk = (kind: ParsedSocial["kind"], handle = "", extra: { ytKind?: ParsedSocial["ytKind"]; query?: string } = {}): ParsedSocial => ({ platform, handle, kind, url: u.origin + u.pathname.replace(/\/$/, "") + (extra.query ?? ""), ytKind: extra.ytKind });
  if (/share|sharer|intent|dialog|plugins|sendto/i.test(u.pathname) || (platform === "whatsapp" && u.searchParams.has("text") && !seg[0])) return mk("share");
  if (!seg.length) return mk("homepage");
  const first = seg[0];
  switch (platform) {
    case "instagram":
      if (["p", "reel", "reels", "tv"].includes(first)) return mk("post");
      if (["explore", "accounts", "stories", "direct", "about", "legal"].includes(first)) return mk("homepage");
      return mk("profile", first);
    case "x":
      if (["home", "i", "search", "hashtag", "explore", "login", "tos", "privacy"].includes(first)) return mk("homepage");
      return mk("profile", first.replace(/^@/, ""));
    case "facebook":
      if (first === "profile.php") { const id = u.searchParams.get("id"); return id ? mk("profile", id, { query: `?id=${id}` }) : mk("homepage"); }
      if (["pages", "people"].includes(first)) return seg[1] ? mk("profile", seg[1]) : mk("homepage");
      if (["groups", "events", "watch", "login", "tr", "policies", "help"].includes(first)) return mk("homepage");
      return mk("profile", first);
    case "youtube":
      if (first.startsWith("@")) return mk("profile", first, { ytKind: "handle" });
      if (["channel", "user", "c"].includes(first)) return seg[1] ? mk("profile", seg[1], { ytKind: first === "c" ? "custom" : (first as "channel" | "user") }) : mk("homepage");
      if (["watch", "shorts", "playlist", "live", "embed"].includes(first)) return mk("post");
      if (["results", "feed", "redirect", "about", "t"].includes(first)) return mk("homepage");
      return mk("profile", first, { ytKind: "custom" });
    case "tiktok":
      return first.startsWith("@") ? (seg[1] === "video" ? mk("post") : mk("profile", first)) : mk("homepage");
    case "linkedin":
      return ["company", "in", "school"].includes(first) && seg[1] ? mk("profile", seg[1]) : mk("homepage");
    case "telegram":
      return first === "s" && seg[1] ? mk("profile", seg[1]) : mk("profile", first);
    case "whatsapp":
      return ["channel", "c"].includes(first) && seg[1] ? mk("profile", seg[1]) : first === "send" ? mk("share") : mk("profile", first);
  }
}

function unwrap(u: URL): URL {
  if (WRAP_HOSTS.has(u.hostname) || (u.hostname.endsWith("youtube.com") && u.pathname === "/redirect")) {
    const t = u.searchParams.get("u") ?? u.searchParams.get("q");
    if (t) { try { return new URL(t); } catch { /* keep */ } }
  }
  return u;
}

/** Anchors, footer links, meta tags (twitter:site, article:publisher) and JSON-LD sameAs. De-duplicated, max 12. */
export function extractSocialLinks(html: string, base: URL): ParsedSocial[] {
  const $ = cheerio.load(html);
  const raw: string[] = [];
  $("a[href]").each((_, el) => { raw.push($(el).attr("href")!); });
  $('meta[name="twitter:site"],meta[name="twitter:creator"]').each((_, el) => { const v = $(el).attr("content")?.trim(); if (v) raw.push(v.startsWith("http") ? v : `https://x.com/${v.replace(/^@/, "")}`); });
  $('meta[property="article:publisher"],meta[property="og:see_also"],meta[property="og:url"]').each((_, el) => { raw.push($(el).attr("content") ?? ""); });
  const walk = (o: any) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(walk);
    for (const [k, v] of Object.entries(o)) { if (k === "sameAs") [v].flat().forEach((x) => typeof x === "string" && raw.push(x)); else walk(v); }
  };
  $('script[type="application/ld+json"]').each((_, el) => { try { walk(JSON.parse($(el).contents().text())); } catch { /* ignore bad JSON-LD */ } });

  const seen = new Set<string>(), out: ParsedSocial[] = [];
  for (const r of raw) {
    let u: URL; try { u = new URL(r, base); } catch { continue; }
    const p = parseSocialUrl(unwrap(u).href);
    if (!p) continue;
    const k = p.kind === "profile" ? `${p.platform}:${p.handle.toLowerCase()}` : `${p.platform}:${p.kind}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(p);
  }
  // Share buttons are normal; only keep them if nothing else was found (they are not the org's own profiles).
  const real = out.filter((p) => p.kind !== "share");
  return real.slice(0, 12);
}

export function tokensFor(domain: string | null, orgName?: string): string[] {
  const label = domain ? domain.split(".")[0] : "";
  const words = `${label.replace(/[-_]/g, " ")} ${orgName ?? ""}`.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/);
  return [...new Set([label.replace(/[-_]/g, ""), ...words].filter((t) => t.length >= 4 && !STOP.has(t)))];
}
export const handleMatchesOrg = (handle: string, tokens: string[]) => {
  const h = handle.toLowerCase().replace(/[^a-z0-9]/g, "");
  return h.length >= 4 && tokens.some((t) => h.includes(t) || (h.length >= 5 && t.includes(h)));
};

export function handleLooksRandom(handle: string): { suspicious: boolean; note?: string } {
  const h = handle.replace(/^@/, "");
  if (/\d{4,}/.test(h) || (h.match(/\d/g) ?? []).length >= 5) return { suspicious: true, note: `Handle "${h}" has a long run of random-looking digits.` };
  if (h.length > 30) return { suspicious: true, note: `Handle "${h}" is unusually long.` };
  if (/(official|real|team|relief|help)[_.]?\w*[_.]?(20\d\d)/i.test(h)) return { suspicious: true, note: `Handle "${h}" bolts "official"-style words onto a year, a common pattern in throwaway accounts.` };
  return { suspicious: false };
}

// Handles seen across the sites this server has analyzed (in-memory, process lifetime).
const seenHandles = new Map<string, Set<string>>();
export const _resetSeenHandles = () => seenHandles.clear();
export function recordHandleUse(platform: string, handle: string, domain: string | null): number {
  if (!domain || !handle) return 0;
  const k = `${platform}:${handle.toLowerCase()}`;
  const set = seenHandles.get(k) ?? new Set();
  set.add(domain); seenHandles.set(k, set);
  return set.size - 1;
}

export interface VerifyCtx { domain: string | null; orgTokens: string[] }
export interface VerifyDeps { fetcher?: (u: URL) => Promise<PageFetch>; fetchImpl?: typeof fetch; light?: boolean }

function readMeta(html: string) {
  const $ = cheerio.load(html);
  const g = (s: string) => $(s).attr("content")?.trim() ?? "";
  return { title: g('meta[property="og:title"]'), desc: [g('meta[property="og:description"]'), g('meta[name="description"]')].filter(Boolean).join(" "), $ };
}
const num = (s: string) => { const m = s.trim().match(/^([\d.,]+)\s*([kKmM]?)$/); if (!m) return undefined; return Math.round(parseFloat(m[1].replace(/,/g, "")) * ({ k: 1e3, m: 1e6 } as Record<string, number>)[m[2].toLowerCase()] || parseFloat(m[1].replace(/,/g, ""))); };

function bioReciprocal(html: string, base: URL, domain: string | null): boolean | null {
  if (!domain) return null;
  const { desc, $ } = readMeta(html);
  const urls: string[] = [...(desc.match(/https?:\/\/[^\s"'<>]+/g) ?? []), ...(desc.match(/\b[a-z0-9-]+\.(?:org|com|net|ngo|charity|foundation)\b/gi) ?? [])];
  const anchors: string[] = [];
  $("a[href]").each((_, el) => { try { anchors.push(unwrap(new URL($(el).attr("href")!, base)).href); } catch { /* skip */ } });
  const matches = (s: string) => { try { return parse(new URL(s.startsWith("http") ? s : `https://${s}`).hostname).domain === domain; } catch { return false; } };
  if (urls.some(matches) || anchors.some(matches)) return true;
  const foreign = urls.map((s) => { try { return parse(new URL(s.startsWith("http") ? s : `https://${s}`).hostname).domain; } catch { return null; } })
    .filter((d): d is string => !!d && !HOSTS[d] && !AGGREGATORS.has(d) && !INFRA.has(d));
  return foreign.length ? false : null; // only a mismatch when the bio itself names a different site
}

async function youtubeCheck(p: ParsedSocial, domain: string | null, fetchImpl: typeof fetch) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;
  const sel = p.ytKind === "channel" ? `id=${encodeURIComponent(p.handle)}` : p.ytKind === "user" ? `forUsername=${encodeURIComponent(p.handle)}` : `forHandle=${encodeURIComponent(p.handle.startsWith("@") ? p.handle : "@" + p.handle)}`;
  const res = await fetchImpl(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&${sel}&key=${key}`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`YouTube API ${res.status}`);
  const item = ((await res.json()) as any).items?.[0];
  if (!item) return { exists: false as const };
  let lastUpload: number | undefined;
  const uploads = item.contentDetails?.relatedPlaylists?.uploads;
  if (uploads) {
    try {
      const r2 = await fetchImpl(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=1&playlistId=${uploads}&key=${key}`, { signal: AbortSignal.timeout(3000) });
      const d = ((await r2.json()) as any).items?.[0]?.snippet?.publishedAt;
      if (d) lastUpload = Math.floor((Date.now() - new Date(d).getTime()) / 864e5);
    } catch { /* optional */ }
  }
  const desc: string = item.snippet?.description ?? "";
  return {
    exists: true as const,
    ageDays: Math.floor((Date.now() - new Date(item.snippet.publishedAt).getTime()) / 864e5),
    subs: item.statistics?.hiddenSubscriberCount ? undefined : Number(item.statistics?.subscriberCount),
    videos: Number(item.statistics?.videoCount ?? 0), lastUpload,
    reciprocal: domain ? (desc.toLowerCase().includes(domain) ? true : null) : null,
  };
}

export async function verifyProfile(p: ParsedSocial, ctx: VerifyCtx, deps: VerifyDeps = {}): Promise<SocialProfile> {
  const f = deps.fetchImpl ?? fetch;
  const out: SocialProfile = { platform: p.platform, handle: p.handle, url: p.url, reachable: null, reciprocalLink: null, verdict: "unverifiable", notes: "" };
  const notes: string[] = [];

  if (p.kind === "homepage") return { ...out, verdict: "suspicious", notes: `Link goes to the ${PLATFORM_NAMES[p.platform]} homepage, not to a real profile.` };
  if (p.kind !== "profile") return { ...out, notes: "Link points to a single post, not a profile, so it can't be checked." };

  let flagged = false;
  const rnd = handleLooksRandom(p.handle);
  if (rnd.suspicious) { flagged = true; notes.push(rnd.note!); }
  const reuse = recordHandleUse(p.platform, p.handle, ctx.domain);
  if (reuse >= 2) { flagged = true; notes.push(`The same profile is linked from ${reuse + 1} unrelated sites we have checked.`); }
  const matches = handleMatchesOrg(p.handle, ctx.orgTokens);

  const finish = (verdict: SocialProfile["verdict"], extra?: string) => ({ ...out, verdict, notes: [...notes, extra].filter(Boolean).join(" ") });

  if (deps.light) { // no profile requests: link integrity and name match only
    if (flagged) return finish("suspicious");
    return matches ? finish("established", "Handle matches the organization's name (light check, profile not contacted).")
      : finish("unverifiable", "Profile not contacted in light mode, and the handle doesn't obviously match the organization's name.");
  }

  try {
    if (p.platform === "youtube") {
      const yt = await youtubeCheck(p, ctx.domain, f);
      if (yt) {
        if (!yt.exists) return { ...finish("suspicious", "No YouTube channel found for this link."), reachable: false };
        Object.assign(out, { reachable: true, ageDays: yt.ageDays, followers: yt.subs, reciprocalLink: yt.reciprocal });
        const recent = yt.lastUpload !== undefined && yt.lastUpload <= 365;
        const stats = `Channel is ${yt.ageDays} days old with ${yt.videos} videos${yt.lastUpload !== undefined ? `, last upload ${yt.lastUpload} days ago` : ""}.`;
        if (yt.videos === 0 || yt.ageDays < 90) return finish("suspicious", `${stats} New or empty channels are a red flag.`);
        if (yt.reciprocal || (yt.ageDays >= 365 && yt.videos >= 5 && recent)) return finish("established", `${stats}${yt.reciprocal ? " Its description links back to the site." : ""}`);
        return finish(flagged ? "suspicious" : "unverifiable", stats);
      }
    }
    if (p.platform === "x") { // X blocks page reads, but its public oEmbed endpoint confirms existence
      const r = await f(`https://publish.twitter.com/oembed?url=${encodeURIComponent(p.url)}`, { signal: AbortSignal.timeout(4000) });
      if (r.status === 404) return { ...finish("suspicious", "This X profile does not exist."), reachable: false };
      if (r.ok) { out.reachable = true; return finish(flagged ? "suspicious" : "unverifiable", "Profile exists (confirmed via X's public embed). X does not expose bio or age without login, so ownership can't be confirmed."); }
      return finish(flagged ? "suspicious" : "unverifiable", "X blocked automated verification. This is not treated as a sign the profile is fake.");
    }

    const pf = await (deps.fetcher ?? ((u: URL) => fetchPage(u, f, 4500)))(new URL(p.url));
    if (pf.status === 404 || pf.status === 410) return { ...finish("suspicious", "Profile does not exist (404)."), reachable: false };
    const wall = !!pf.finalUrl && /login|checkpoint|signin|authwall/i.test(pf.finalUrl.pathname + pf.finalUrl.search);
    if (!pf.ok || wall || !pf.html) {
      out.reachable = pf.status && pf.status < 400 && !wall ? true : null;
      return finish(flagged ? "suspicious" : "unverifiable", `${PLATFORM_NAMES[p.platform]} blocked automated verification. This is not treated as a sign the profile is fake.`);
    }
    out.reachable = true;
    const { desc } = readMeta(pf.html);
    const ig = desc.match(/([\d.,]+[kKmM]?)\s+Followers.*?([\d.,]+[kKmM]?)\s+Posts/i);
    if (ig) { out.followers = num(ig[1]); if (num(ig[2]) === 0) return finish("suspicious", "Profile has no posts.", ); }
    out.reciprocalLink = bioReciprocal(pf.html, new URL(p.url), ctx.domain);
    if (out.reciprocalLink) return finish("established", "Profile's bio links back to this site.");
    if (out.reciprocalLink === false) return finish("suspicious", "Profile's bio points to a different website than this one.");
    if (flagged) return finish("suspicious");
    return finish("unverifiable", matches ? "Profile is reachable and the handle matches the organization, but nothing public links it back to the site." : "Profile is reachable, but nothing public links it to this site.");
  } catch (e) {
    return finish(flagged ? "suspicious" : "unverifiable", `Could not verify (${(e as Error).message}).`);
  }
}

export async function verifyAll(links: ParsedSocial[], ctx: VerifyCtx, deps: VerifyDeps = {}): Promise<SocialProfile[]> {
  return Promise.all(links.slice(0, 6).map((l) => verifyProfile(l, ctx, deps)));
}

export function socialSignals(profiles: SocialProfile[], opts: { asksForMoney: boolean; includePresence?: boolean }): Signal[] {
  const out: Signal[] = [];
  const base = { category: "social" as const };
  if (opts.includePresence !== false) {
    const real = profiles.filter((p) => p.handle);
    if (!profiles.length)
      out.push({ ...base, id: "social-presence", label: "Social media presence", weight: opts.asksForMoney ? 1.5 : 0.5, score: opts.asksForMoney ? 0.3 : 0.6, severity: opts.asksForMoney ? "medium" : "low", evidence: opts.asksForMoney ? "The page asks for money but links to no social media profiles." : "No social media links found on the page." });
    else if (!real.length)
      out.push({ ...base, id: "social-presence", label: "Social media presence", weight: 1.5, score: 0.15, severity: "high", evidence: "Every social link goes to a platform homepage instead of a real profile." });
    else out.push({ ...base, id: "social-presence", label: "Social media presence", weight: 0.5, score: 1, severity: "info", evidence: `Links to ${real.length} profile(s): ${real.map((p) => PLATFORM_NAMES[p.platform]).join(", ")}.` });
  }
  for (const p of profiles) {
    const s = p.verdict === "established" ? 1 : p.verdict === "suspicious" ? 0.1 : 0.5;
    out.push({ ...base, id: `social-${p.platform}-${p.handle || "home"}`, label: `${PLATFORM_NAMES[p.platform]}${p.handle ? " " + (p.handle.startsWith("@") ? p.handle : "@" + p.handle) : " link"}`,
      weight: p.verdict === "unverifiable" ? 0.5 : 1.5, score: s, severity: p.verdict === "suspicious" ? "high" : p.verdict === "unverifiable" ? "low" : "info",
      evidence: `${p.verdict === "unverifiable" ? "Unverifiable (neutral score). " : ""}${p.notes}` });
  }
  return out;
}

/** For a social-profile input: find the website the profile points to (bio redirect links first). */
export async function resolveSocialWebsite(p: ParsedSocial, deps: VerifyDeps = {}): Promise<string | null> {
  const pf = await (deps.fetcher ?? ((u: URL) => fetchPage(u, deps.fetchImpl ?? fetch, 4500)))(new URL(p.url));
  if (!pf.ok || !pf.html) return null;
  const $ = cheerio.load(pf.html), base = new URL(p.url);
  const usable = (u: URL) => { const d = parse(u.hostname).domain; return !!d && /^https?:$/.test(u.protocol) && !HOSTS[d] && !AGGREGATORS.has(d) && !INFRA.has(d) ? u.href : null; };
  const wrapped: string[] = [], plain: string[] = [];
  $("a[href]").each((_, el) => { try { const raw = new URL($(el).attr("href")!, base); const un = unwrap(raw); const ok = usable(un); if (ok) (un !== raw ? wrapped : plain).push(ok); } catch { /* skip */ } });
  const desc = readMeta(pf.html).desc;
  const fromDesc = (desc.match(/https?:\/\/[^\s"'<>]+/g) ?? []).map((s) => { try { return usable(new URL(s)); } catch { return null; } }).filter(Boolean) as string[];
  return wrapped[0] ?? fromDesc[0] ?? plain[0] ?? null;
}
