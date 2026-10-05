import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseSocialUrl, extractSocialLinks, handleLooksRandom, handleMatchesOrg, tokensFor, verifyProfile, socialSignals, resolveSocialWebsite, recordHandleUse, _resetSeenHandles, type ParsedSocial } from "../src/providers/social.js";
import { computeScore } from "../src/scoring.js";
import type { PageFetch } from "../src/safeFetch.js";

const U = new URL("https://helpfund.org/");
const page = (html: string, status = 200, finalUrl = "https://example.com/p"): PageFetch => ({ ok: status < 400, status, chain: [], headers: {}, html, finalUrl: new URL(finalUrl) });
const prof = (url: string) => parseSocialUrl(url) as ParsedSocial;
const ctx = { domain: "helpfund.org", orgTokens: ["helpfund"] };
beforeEach(() => _resetSeenHandles());

describe("parseSocialUrl", () => {
  it("parses profiles", () => {
    expect(parseSocialUrl("https://www.instagram.com/unicef/")).toMatchObject({ platform: "instagram", handle: "unicef", kind: "profile" });
    expect(parseSocialUrl("https://twitter.com/redcross")).toMatchObject({ platform: "x", handle: "redcross", kind: "profile" });
    expect(parseSocialUrl("https://www.youtube.com/@unicef")).toMatchObject({ platform: "youtube", handle: "@unicef", ytKind: "handle" });
    expect(parseSocialUrl("https://www.youtube.com/channel/UC123")).toMatchObject({ handle: "UC123", ytKind: "channel" });
    expect(parseSocialUrl("https://www.tiktok.com/@savethechildren")).toMatchObject({ platform: "tiktok", kind: "profile" });
    expect(parseSocialUrl("https://www.linkedin.com/company/unicef")).toMatchObject({ platform: "linkedin", handle: "unicef" });
    expect(parseSocialUrl("https://www.facebook.com/profile.php?id=123")).toMatchObject({ handle: "123", kind: "profile" });
    expect(parseSocialUrl("https://t.me/somechannel")).toMatchObject({ platform: "telegram", handle: "somechannel" });
  });
  it("flags homepages, posts and share links instead of profiles", () => {
    expect(parseSocialUrl("https://facebook.com")!.kind).toBe("homepage");
    expect(parseSocialUrl("https://instagram.com/p/abc123/")!.kind).toBe("post");
    expect(parseSocialUrl("https://twitter.com/intent/tweet?url=x")!.kind).toBe("share");
    expect(parseSocialUrl("https://www.facebook.com/sharer/sharer.php?u=x")!.kind).toBe("share");
    expect(parseSocialUrl("https://wa.me/?text=hi")!.kind).toBe("share");
  });
  it("ignores non-social and non-http links", () => { expect(parseSocialUrl("https://example.com/a")).toBeNull(); expect(parseSocialUrl("javascript:alert(1)")).toBeNull(); });
});

describe("extractSocialLinks", () => {
  const html = `<head><meta name="twitter:site" content="@helpfund"><meta property="article:publisher" content="https://www.facebook.com/helpfund">
    <script type="application/ld+json">{"@type":"Organization","sameAs":["https://www.youtube.com/@helpfund","https://instagram.com/helpfund"]}</script></head>
    <body><footer><a href="https://instagram.com/helpfund/">IG</a><a href="https://twitter.com/helpfund">X</a><a href="https://twitter.com/intent/tweet?text=hi">Share</a>
    <a href="https://www.tiktok.com/">TT</a><a href="/about">about</a></footer></body>`;
  it("collects from anchors, meta tags and JSON-LD, de-duplicated, without share links", () => {
    const l = extractSocialLinks(html, U);
    const keys = l.map((p) => `${p.platform}:${p.handle || p.kind}`).sort();
    expect(keys).toEqual(["facebook:helpfund", "instagram:helpfund", "tiktok:homepage", "x:helpfund", "youtube:@helpfund"]);
  });
});

describe("handle checks", () => {
  it("flags random-digit handles", () => { expect(handleLooksRandom("reliefhelp_official_2024x93").suspicious).toBe(true); expect(handleLooksRandom("unicef").suspicious).toBe(false); });
  it("matches handles to the org name", () => { const t = tokensFor("helpfund.org", "Help Fund Inc"); expect(handleMatchesOrg("helpfund_official", t)).toBe(true); expect(handleMatchesOrg("randomshop", t)).toBe(false); });
  it("detects one handle reused across unrelated sites", () => {
    recordHandleUse("instagram", "scammer", "a.org"); recordHandleUse("instagram", "scammer", "b.org");
    expect(recordHandleUse("instagram", "scammer", "c.org")).toBe(2);
  });
});

describe("verifyProfile", () => {
  it("homepage link is suspicious", async () => expect((await verifyProfile(prof("https://facebook.com"), ctx)).verdict).toBe("suspicious"));
  it("404 means the profile is dead", async () => {
    const r = await verifyProfile(prof("https://instagram.com/helpfund"), ctx, { fetcher: async () => page("", 404) });
    expect(r).toMatchObject({ verdict: "suspicious", reachable: false });
  });
  it("a bio that links back to the domain is established", async () => {
    const html = `<meta property="og:description" content="1,200 Followers, 10 Following, 85 Posts - Help Fund. Donate at https://helpfund.org">`;
    const r = await verifyProfile(prof("https://instagram.com/helpfund"), ctx, { fetcher: async () => page(html) });
    expect(r).toMatchObject({ verdict: "established", reciprocalLink: true, followers: 1200 });
  });
  it("a bio pointing to a different site is suspicious", async () => {
    const html = `<meta property="og:description" content="Official page. Donate at https://other-fund.com">`;
    expect((await verifyProfile(prof("https://instagram.com/helpfund"), ctx, { fetcher: async () => page(html) })).reciprocalLink).toBe(false);
  });
  it("an empty profile is suspicious", async () => {
    const html = `<meta property="og:description" content="3 Followers, 0 Following, 0 Posts">`;
    expect((await verifyProfile(prof("https://instagram.com/helpfund"), ctx, { fetcher: async () => page(html) })).verdict).toBe("suspicious");
  });
  it("blocked platforms are unverifiable, never fake", async () => {
    for (const status of [403, 429, 999]) {
      const r = await verifyProfile(prof("https://instagram.com/helpfund"), ctx, { fetcher: async () => page("", status) });
      expect(r.verdict).toBe("unverifiable"); expect(r.notes).toMatch(/not treated as a sign/i);
    }
    const wall = await verifyProfile(prof("https://instagram.com/helpfund"), ctx, { fetcher: async () => page("<html>log in</html>", 200, "https://www.instagram.com/accounts/login/") });
    expect(wall.verdict).toBe("unverifiable");
  });
  it("random handles are suspicious even when blocked", async () => expect((await verifyProfile(prof("https://instagram.com/reliefhelp_official_2024x93"), ctx, { fetcher: async () => page("", 403) })).verdict).toBe("suspicious"));
  it("light mode makes no profile requests", async () => {
    const fetcher = vi.fn(); const r = await verifyProfile(prof("https://instagram.com/helpfund"), ctx, { light: true, fetcher });
    expect(fetcher).not.toHaveBeenCalled(); expect(r.verdict).toBe("established");
    expect((await verifyProfile(prof("https://instagram.com/unrelated_name"), ctx, { light: true, fetcher })).verdict).toBe("unverifiable");
  });
  describe("X and YouTube official endpoints", () => {
    afterEach(() => vi.unstubAllEnvs());
    it("X oEmbed 404 means no such profile; other failures are unverifiable", async () => {
      expect((await verifyProfile(prof("https://x.com/helpfund"), ctx, { fetchImpl: (async () => new Response("", { status: 404 })) as any })).verdict).toBe("suspicious");
      expect((await verifyProfile(prof("https://x.com/helpfund"), ctx, { fetchImpl: (async () => new Response("", { status: 403 })) as any })).verdict).toBe("unverifiable");
    });
    it("YouTube API: old active channel is established, new empty one is suspicious", async () => {
      vi.stubEnv("YOUTUBE_API_KEY", "k");
      const ch = (days: number, videos: number, desc = "") => ({ items: [{ snippet: { publishedAt: new Date(Date.now() - days * 864e5).toISOString(), description: desc }, statistics: { subscriberCount: "5000", videoCount: String(videos) }, contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] });
      const mk = (c: any) => (async (u: any) => new Response(JSON.stringify(String(u).includes("playlistItems") ? { items: [{ snippet: { publishedAt: new Date(Date.now() - 20 * 864e5).toISOString() } }] } : c))) as any;
      const good = await verifyProfile(prof("https://youtube.com/@helpfund"), ctx, { fetchImpl: mk(ch(1500, 120, "Visit helpfund.org")) });
      expect(good).toMatchObject({ verdict: "established", reciprocalLink: true, followers: 5000 });
      expect((await verifyProfile(prof("https://youtube.com/@helpfund"), ctx, { fetchImpl: mk(ch(10, 0)) })).verdict).toBe("suspicious");
      expect((await verifyProfile(prof("https://youtube.com/@helpfund"), ctx, { fetchImpl: mk({ items: [] }) })).reachable).toBe(false);
    });
  });
});

describe("social signals and scoring", () => {
  it("no social links on a donation page is a red flag; none on a non-asking page is mild", () => {
    expect(socialSignals([], { asksForMoney: true })[0]).toMatchObject({ score: 0.3, severity: "medium" });
    expect(socialSignals([], { asksForMoney: false })[0].severity).toBe("low");
  });
  it("homepage-only links are a high-severity flag", () => {
    const hp = { platform: "facebook" as const, handle: "", url: "https://facebook.com", reachable: null, reciprocalLink: null, verdict: "suspicious" as const, notes: "x" };
    expect(socialSignals([hp], { asksForMoney: true }).find((s) => s.id === "social-presence")).toMatchObject({ score: 0.15, severity: "high" });
  });
  it("unverifiable profiles are neutral and low-weight, and don't raise confidence", () => {
    const u = { platform: "instagram" as const, handle: "x", url: "u", reachable: null, reciprocalLink: null, verdict: "unverifiable" as const, notes: "blocked" };
    const s = socialSignals([u], { asksForMoney: false, includePresence: false })[0];
    expect(s).toMatchObject({ score: 0.5, weight: 0.5 }); expect(s.evidence).toMatch(/^Unverifiable/);
  });
  it("an established profile helps, a suspicious one hurts", () => {
    const mkp = (verdict: "established" | "suspicious") => socialSignals([{ platform: "youtube", handle: "@a", url: "u", reachable: true, reciprocalLink: null, verdict, notes: "" }], { asksForMoney: false, includePresence: false });
    const base = [{ id: "b", label: "", category: "content" as const, weight: 3, score: 0.5, evidence: "", severity: "info" as const }];
    expect(computeScore([...base, ...mkp("established")], null, false, 5).score).toBeGreaterThan(computeScore([...base, ...mkp("suspicious")], null, false, 5).score);
  });
});

describe("resolveSocialWebsite", () => {
  it("unwraps Instagram's redirect link to the real site", async () => {
    const html = `<a href="https://l.instagram.com/?u=https%3A%2F%2Fhelpfund.org%2Fdonate&e=1">link</a><a href="https://example-cdn.fbcdn.net/x">cdn</a>`;
    expect(await resolveSocialWebsite(prof("https://instagram.com/helpfund"), { fetcher: async () => page(html) })).toBe("https://helpfund.org/donate");
  });
  it("returns null when nothing is public or the page is blocked", async () => {
    expect(await resolveSocialWebsite(prof("https://instagram.com/helpfund"), { fetcher: async () => page("<p>none</p>") })).toBeNull();
    expect(await resolveSocialWebsite(prof("https://instagram.com/helpfund"), { fetcher: async () => page("", 403) })).toBeNull();
  });
});
