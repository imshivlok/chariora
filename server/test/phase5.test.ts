import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { analyzeContent } from "../src/providers/content.js";
import { lookalikeSignal } from "../src/providers/domain.js";
import { computeScore } from "../src/scoring.js";
import { app } from "../src/index.js";

const req = createRequire(import.meta.url);
const C = req("../../extension/lib/core.js");
const ext = (p: string) => new URL(`../../extension/${p}`, import.meta.url);

describe("extension core helpers", () => {
  it("cleanBase validates and trims", () => {
    expect(C.cleanBase(" http://localhost:8787/// ")).toBe("http://localhost:8787");
    expect(C.cleanBase("ftp://x.org")).toBeNull();
    expect(C.cleanBase("not a url")).toBeNull();
  });
  it.each(["chrome://extensions", "file:///etc/passwd", "http://localhost:3000", "http://127.0.0.1", "http://192.168.1.4", "http://10.1.1.1", "http://intranet", "about:blank"])("refuses to check %s", (u) => expect(C.isCheckableUrl(u)).toBe(false));
  it("checks public sites", () => { expect(C.isCheckableUrl("https://redcross.org/donate")).toBe(true); expect(C.isCheckableUrl("http://example.com")).toBe(true); });
  it("sends only the origin, never path or query", () => expect(C.targetFor("https://a.org/donate/secret?token=1#x")).toBe("https://a.org"));
  it("cache key ignores www and case", () => expect(C.cacheKey("https://WWW.Example.org/x")).toBe("example.org"));
  it("cache freshness honors the 24h TTL", () => {
    expect(C.isFresh({ at: 1000 }, 1000 + 1000)).toBe(true);
    expect(C.isFresh({ at: 1000 }, 1000 + C.CACHE_TTL_MS + 1)).toBe(false);
    expect(C.isFresh(undefined)).toBe(false);
  });
  it("detects donation pages by address, title and buttons", () => {
    expect(C.looksLikeDonationPage({ url: "https://x.org/donate", title: "", headings: [], buttons: [] })).toBe(true);
    expect(C.looksLikeDonationPage({ url: "https://x.org/", title: "Hurricane relief fundraiser", headings: [], buttons: ["Donate now"] })).toBe(true);
    expect(C.looksLikeDonationPage({ url: "https://shop.com/", title: "Spring sale", headings: ["Shoes"], buttons: ["Buy"] })).toBe(false);
    expect(C.looksLikeDonationPage({ url: "https://news.com/story", title: "Relief from allergies", headings: [], buttons: [] })).toBe(false);
  });
  it("only warns for Suspicious or worse", () => {
    for (const v of ["Verified Charity", "Likely Legitimate"]) expect(C.shouldWarn({ verdict: v })).toBe(false);
    for (const v of ["Suspicious - Verify Before Donating", "Likely Fake", "Almost Certainly a Scam"]) expect(C.shouldWarn({ verdict: v })).toBe(true);
    expect(C.verdictTone("Likely Fake")).toBe("bad");
    expect(C.shouldWarn(null)).toBe(false);
  });
  it("builds a report URL the web app can reconstruct", () => {
    const u = new URL(C.buildReportUrl("http://localhost:5173/", "https://a.org"));
    expect(u.pathname).toBe("/check"); expect(u.searchParams.get("target")).toBe("https://a.org");
    expect(C.buildReportUrl("garbage", "https://a.org")).toBe("http://localhost:5173/check?target=https%3A%2F%2Fa.org");
  });
  it("slimResult keeps only what the extension needs", () => {
    const s = C.slimResult({ verdict: "Likely Fake", score: 12, confidence: "low", source: "analysis", normalizedDomain: "a.org", registry: { found: false }, signals: [1, 2, 3], summary: "long", checkedAt: "t" });
    expect(Object.keys(s).sort()).toEqual(["checkedAt", "confidence", "normalizedDomain", "registry", "score", "source", "verdict"]);
    expect(s.registry).toBeNull();
  });
  it("needle angle spans -90..90 and clamps", () => { expect(C.needleAngle(0)).toBe(-90); expect(C.needleAngle(50)).toBe(0); expect(C.needleAngle(100)).toBe(90); expect(C.needleAngle(500)).toBe(90); });
});

describe("extension manifest", () => {
  const m = JSON.parse(readFileSync(ext("manifest.json"), "utf8"));
  it("is Manifest V3 with minimal permissions", () => {
    expect(m.manifest_version).toBe(3);
    expect([...m.permissions].sort()).toEqual(["activeTab", "storage"]);
    expect(m.host_permissions).toEqual(["http://localhost:8787/*"]);
  });
  it("references files that exist", () => {
    const files = [m.background.service_worker, m.action.default_popup, ...Object.values<string>(m.icons), ...m.content_scripts.flatMap((c: any) => c.js)];
    for (const f of files) expect(existsSync(ext(f)), f).toBe(true);
  });
  it("content script runs in the top frame only", () => expect(m.content_scripts[0].all_frames).toBe(false));
});

describe("demo cases", () => {
  it("template scam fixture lands in a low tier", () => {
    const html = readFileSync(new URL("../../demo/scam-page.html", import.meta.url), "utf8");
    const a = analyzeContent(html, new URL("https://hurricane-relief-fund.example/"));
    expect(a.signals.filter((s) => s.score < 0.4).length).toBeGreaterThanOrEqual(4);
    expect(computeScore(a.signals, null, false, 1).score).toBeLessThan(40);
  });
  it("lookalike domain is flagged, the real one is not", () => {
    expect(lookalikeSignal("red-cross-relief.xyz").severity).toBe("high");
    expect(lookalikeSignal("redcross.org").severity).toBe("info");
  });
});

describe("API gateway", () => {
  let server: Server, base = "";
  beforeAll(async () => { server = app.listen(0); await new Promise((r) => server.once("listening", r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
  afterAll(() => { server.close(); });
  const post = (body: unknown) => fetch(`${base}/api/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("health check", async () => expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: true }));
  it("rejects a missing target", async () => expect((await post({})).status).toBe(400));
  it.each(["http://localhost:3000", "http://169.254.169.254/latest", "ftp://x.org"])("blocks unsafe target %s", async (t) => expect((await post({ target: t })).status).toBe(400));
  it("stream reports a failure event for a missing target", async () => {
    const text = await (await fetch(`${base}/api/analyze/stream`)).text();
    expect(text).toContain("event: fail");
  });
  it("unknown API routes return JSON 404", async () => { const r = await fetch(`${base}/api/nope`); expect(r.status).toBe(404); expect((await r.json()).error).toBeTruthy(); });
  it("sets basic security headers and hides x-powered-by", async () => {
    const r = await fetch(`${base}/api/health`);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("x-powered-by")).toBeNull();
  });
});

describe("extension service worker", () => {
  /** Runs background.js in a sandbox with a fake chrome.* and fetch. */
  function boot(fetchImpl: (url: string, init?: any) => Promise<any>) {
    const local: Record<string, any> = {}, calls: any[] = [];
    let listener: any;
    const chrome = {
      runtime: { onInstalled: { addListener() {} }, onMessage: { addListener: (fn: any) => { listener = fn; } } },
      storage: {
        sync: { get: async (d: any) => ({ ...d }), set: async () => {} },
        local: {
          get: async (k: any) => (k === null ? { ...local } : { [k]: local[k] }),
          set: async (o: any) => { Object.assign(local, o); },
          remove: async (ks: string[]) => ks.forEach((k) => delete local[k]),
        },
      },
      action: { setBadgeText: async (a: any) => { calls.push(["text", a]); }, setBadgeBackgroundColor: async (a: any) => { calls.push(["color", a]); } },
    };
    const sandbox: any = { chrome, fetch: fetchImpl, importScripts: () => {}, console, setTimeout, clearTimeout, AbortController, URL, Promise };
    sandbox.self = sandbox; sandbox.ChariCore = C;
    vm.runInNewContext(readFileSync(ext("background.js"), "utf8"), sandbox);
    const send = (msg: any, sender: any = {}) => new Promise<any>((resolve) => { const async_ = listener(msg, sender, resolve); if (!async_) resolve(undefined); });
    return { send, local, calls };
  }
  const full = { verdict: "Likely Fake", score: 12, confidence: "medium", source: "analysis", normalizedDomain: "a.org", registry: { found: false }, partial: false, checkedAt: "t", signals: [] };
  const okFetch = (hits: string[]) => async (url: string, init: any) => { hits.push(url + " " + init.body); return { ok: true, status: 200, json: async () => full }; };

  it("calls the API once, caches the slim result, and serves the second check from cache", async () => {
    const hits: string[] = [];
    const sw = boot(okFetch(hits));
    const a = await sw.send({ type: "check", target: "https://a.org/donate?x=1" }, { tab: { id: 7 } });
    expect(a.ok).toBe(true); expect(a.result.score).toBe(12); expect(a.result.signals).toBeUndefined();
    expect(hits).toEqual(['http://localhost:8787/api/analyze {"target":"https://a.org"}']); // origin only
    const b = await sw.send({ type: "check", target: "https://www.a.org/other" });
    expect(b.cached).toBe(true); expect(hits.length).toBe(1);
    expect(sw.calls.find((c) => c[0] === "text")[1]).toEqual({ tabId: 7, text: "!" });
  });
  it("does not cache partial results", async () => {
    const sw = boot(async () => ({ ok: true, status: 200, json: async () => ({ ...full, partial: true }) }));
    const r = await sw.send({ type: "check", target: "https://a.org" });
    expect(r.partial).toBe(true); expect(Object.keys(sw.local).filter((k) => k.startsWith("cache:"))).toEqual([]);
  });
  it("turns network failure, 429 and API errors into readable messages", async () => {
    expect((await boot(async () => { throw new TypeError("fetch failed"); }).send({ type: "check", target: "https://a.org" })).error).toMatch(/Couldn't reach the Chariora server/);
    expect((await boot(async () => ({ ok: false, status: 429, json: async () => ({}) })).send({ type: "check", target: "https://a.org" })).error).toMatch(/Too many checks/);
    expect((await boot(async () => ({ ok: false, status: 400, json: async () => ({ error: "bad" }) })).send({ type: "check", target: "https://a.org" })).error).toBe("bad");
  });
  it("ignores messages for uncheckable targets", async () => {
    const hits: string[] = []; const sw = boot(okFetch(hits));
    expect(await sw.send({ type: "check", target: "http://localhost:3000" })).toBeUndefined();
    expect(await sw.send({ type: "other" })).toBeUndefined();
    expect(hits.length).toBe(0);
  });
});
