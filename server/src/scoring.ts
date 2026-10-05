import type { AnalysisResult, RegistryResult, Signal, Verdict } from "../../shared/types.js";

export function tierFor(score: number, verifiedAllowed: boolean): Verdict {
  if (score >= 85) return verifiedAllowed ? "Verified Charity" : "Likely Legitimate";
  if (score >= 65) return "Likely Legitimate";
  if (score >= 40) return "Suspicious - Verify Before Donating";
  if (score >= 20) return "Likely Fake";
  return "Almost Certainly a Scam";
}

/** Weight given to the LLM so it is ~25% of the total. Skipping the LLM simply renormalizes the rest. */
export const llmWeightFor = (others: Signal[]) => others.reduce((n, s) => n + s.weight, 0) / 3;

/** providersResponded = how many independent providers returned data (registry, domain, technical, reputation, content, llm). */
export function computeScore(signals: Signal[], registry: RegistryResult | null, hardFail = false, providersResponded = 0) {
  const live = signals.filter((s) => s.weight > 0);
  const total = live.reduce((n, s) => n + s.weight, 0);
  let score = total ? (live.reduce((n, s) => n + s.weight * s.score, 0) / total) * 100 : 50;
  const verified = !!registry?.found && !!registry.domainMatches;
  if (verified) score = Math.max(score, 85); // registry + domain match raises the floor
  const confidence: AnalysisResult["confidence"] = verified || providersResponded >= 5 ? "high" : providersResponded >= 3 ? "medium" : "low";
  // No positive proof and too little evidence: never rank above "Suspicious".
  if (!verified && confidence === "low") score = Math.min(score, 64);
  if (hardFail) score = Math.min(score, 10); // Safe Browsing / phishing hit forces the lowest tier
  score = Math.round(Math.max(0, Math.min(100, score)));
  return { score, verdict: tierFor(score, verified), confidence };
}
