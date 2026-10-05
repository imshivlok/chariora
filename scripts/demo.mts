/* Chariora demo: three cases a judge can run in a minute.
 *   1. A real charity               (live: needs the API server + internet)
 *   2. A lookalike domain           (live: needs the API server + internet)
 *   3. A template scam page         (offline fixture; also live if DEMO_SCAM_URL is set)
 * Usage: npm run dev (in another terminal), then npm run demo
 * Env: DEMO_API (default http://localhost:8787), DEMO_SCAM_URL (a public URL hosting demo/scam-page.html) */
import { readFileSync } from "node:fs";
import { analyzeContent } from "../server/src/providers/content.js";
import { computeScore } from "../server/src/scoring.js";
import type { AnalysisResult } from "../shared/types.js";

const API = (process.env.DEMO_API ?? "http://localhost:8787").replace(/\/+$/, "");
const bad = (v: string) => !/^(Verified Charity|Likely Legitimate)$/.test(v);
let failures = 0;

function report(n: number, title: string, summary: string, ok: boolean, why: string) {
  console.log(`\n${n}. ${title}\n   ${summary}\n   Expectation: ${why} -> ${ok ? "PASS" : "FAIL"}`);
  if (!ok) failures++;
}
const why = (r: AnalysisResult) => (r.errors.length ? `\n   Provider errors: ${r.errors.join(" | ")}` : "");
const describe = (r: AnalysisResult) => `${r.verdict}, ${r.score}/100, confidence ${r.confidence}${r.partial ? " (partial)" : ""}`;

async function live(target: string): Promise<AnalysisResult | null> {
  try {
    const res = await fetch(`${API}/api/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target }), signal: AbortSignal.timeout(25000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as AnalysisResult;
  } catch (e) {
    console.log(`   Could not reach ${API} (${(e as Error).message}). Start it with "npm run dev".`);
    return null;
  }
}

console.log("Chariora demo");

const real = await live("redcross.org");
if (real) report(1, "Real charity: redcross.org", describe(real) + `; registry: ${real.registry?.found ? "EIN " + real.registry.id : "not found"}` + (real.verdict === "Verified Charity" ? "" : why(real)),
  real.verdict === "Verified Charity", "registry match + matching domain -> Verified Charity");
else { console.log("\n1. Real charity: redcross.org\n   SKIPPED (server unreachable)"); failures++; }

const fake = await live("red-cross-relief.xyz");
if (fake) {
  const look = fake.signals.find((s) => s.id === "lookalike");
  report(2, "Lookalike domain: red-cross-relief.xyz", describe(fake) + `; lookalike: ${look?.evidence ?? "no signal"}`,
    bad(fake.verdict) && look?.severity === "high", "flagged as a lookalike and NOT rated legitimate");
} else { console.log("\n2. Lookalike domain: red-cross-relief.xyz\n   SKIPPED (server unreachable)"); failures++; }

// Case 3: the fixture always runs offline (the API refuses localhost on purpose, to block SSRF).
const html = readFileSync(new URL("../demo/scam-page.html", import.meta.url), "utf8");
const content = analyzeContent(html, new URL("https://hurricane-relief-fund.example/"));
const off = computeScore(content.signals, null, false, 1);
const worst = content.signals.filter((s) => s.score < 0.4).map((s) => s.label);
report(3, "Template scam page (offline fixture: demo/scam-page.html)", `${off.verdict}, ${off.score}/100; red signals: ${worst.join(", ")}`,
  off.score < 40 && worst.length >= 4, "score under 40 with at least 4 failing content signals");
if (process.env.DEMO_SCAM_URL) {
  const r = await live(process.env.DEMO_SCAM_URL);
  if (r) report(3, `Template scam page (live: ${process.env.DEMO_SCAM_URL})`, describe(r), r.score < 40, "score under 40");
}

console.log(`\n${failures ? failures + " check(s) did not pass." : "All demo checks passed."}`);
process.exit(failures ? 1 : 0);
