import type { Signal } from "../../../shared/types.js";

/** Google Safe Browsing v4. Returns null (skipped) when no key is configured. */
export async function checkSafeBrowsing(url: string, fetchImpl: typeof fetch = fetch): Promise<{ hit: boolean; signal: Signal } | null> {
  const key = process.env.SAFE_BROWSING_API_KEY;
  if (!key) return null;
  const res = await fetchImpl(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${key}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(5000),
    body: JSON.stringify({ client: { clientId: "chariora", clientVersion: "0.1" }, threatInfo: { threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"], platformTypes: ["ANY_PLATFORM"], threatEntryTypes: ["URL"], threatEntries: [{ url }] } }),
  });
  if (!res.ok) throw new Error(`Safe Browsing returned ${res.status}`);
  const data: any = await res.json();
  const types: string[] = (data.matches ?? []).map((m: any) => m.threatType);
  const hit = types.length > 0;
  return { hit, signal: { id: "safe-browsing", label: "Google Safe Browsing", category: "reputation", weight: hit ? 6 : 2, score: hit ? 0 : 1, severity: hit ? "high" : "info", evidence: hit ? `Google flags this URL: ${types.join(", ")}.` : "Not flagged by Google Safe Browsing." } };
}
