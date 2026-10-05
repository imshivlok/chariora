import type { AnalysisResult, ProgressStep, RegistryResult, Signal, SocialProfile } from "../../shared/types.js";
import { normalizeInput } from "./normalize.js";
import { lookupRegistry, KNOWN_ORGS } from "./providers/registry.js";
import { computeScore, llmWeightFor } from "./scoring.js";
import { fetchPage, type PageFetch } from "./safeFetch.js";
import { extractSocialLinks, parseSocialUrl, resolveSocialWebsite, socialSignals, tokensFor, verifyAll, verifyProfile, type ParsedSocial } from "./providers/social.js";
import { lookupDomain, lookalikeSignal } from "./providers/domain.js";
import { technicalSignals } from "./providers/technical.js";
import { checkSafeBrowsing } from "./providers/reputation.js";
import { analyzeContent } from "./providers/content.js";
import { judgePage, llmConfigured, llmSignal } from "./llm.js";
import { LruCache } from "./cache.js";

const cache = new LruCache<AnalysisResult>();
const SHORTENERS = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "cutt.ly", "rb.gy", "is.gd", "shorturl.at"];
const RISKY_TLDS = ["xyz", "top", "click", "buzz", "icu", "shop", "live", "site", "online", "cfd", "sbs"];

function urlSignals(url?: URL, domain?: string | null): Signal[] {
  if (!url || !domain) return [];
  const tld = domain.split(".").pop() ?? "";
  const label = domain.split(".")[0];
  const s: Signal[] = [
    { id: "https", label: "Secure connection (HTTPS)", category: "technical", weight: 1, score: url.protocol === "https:" ? 1 : 0.1, severity: url.protocol === "https:" ? "info" : "medium", evidence: url.protocol === "https:" ? "Link uses HTTPS." : "Link uses plain HTTP; donations should never be sent over it." },
    { id: "shortener", label: "URL shortener", category: "technical", weight: 2, score: SHORTENERS.includes(domain) ? 0 : 1, severity: SHORTENERS.includes(domain) ? "high" : "info", evidence: SHORTENERS.includes(domain) ? "Shortened links hide the real destination." : "Not a known URL shortener." },
    { id: "tld", label: "Domain extension", category: "domain", weight: 1.5, score: RISKY_TLDS.includes(tld) ? 0.25 : 0.9, severity: RISKY_TLDS.includes(tld) ? "medium" : "info", evidence: `.${tld} ${RISKY_TLDS.includes(tld) ? "is commonly used by throwaway sites." : "is not flagged as high-risk."}` },
  ];
  const digits = (label.match(/\d/g) ?? []).length;
  const hyphens = (label.match(/-/g) ?? []).length;
  const odd = digits >= 3 || hyphens >= 3;
  s.push({ id: "name-shape", label: "Domain name pattern", category: "domain", weight: 1, score: odd ? 0.2 : 0.85, severity: odd ? "medium" : "info", evidence: odd ? "Many digits or hyphens, a common pattern in throwaway domains." : "Domain name looks ordinary." });
  return s;
}

function registrySignal(r: RegistryResult, hasDomain: boolean): Signal {
  if (r.found && r.domainMatches)
    return { id: "registry", label: "Registry match", category: "registry", weight: 6, score: 1, severity: "info", evidence: `${r.name} (EIN ${r.id}) is in the IRS data via ProPublica, and this domain is on its known-domain list.` };
  if (r.found && hasDomain)
    return { id: "registry", label: "Registry match, domain unconfirmed", category: "registry", weight: 3, score: 0.3, severity: "high", evidence: `A charity named "${r.name}" exists (EIN ${r.id}), but this website could not be confirmed as belonging to it. Impersonation risk.` };
  if (r.found)
    return { id: "registry", label: "Found in registry", category: "registry", weight: 4, score: 0.75, severity: "info", evidence: `${r.name} (EIN ${r.id}) is a registered US nonprofit. Check the official website independently.` };
  if (!hasDomain) return { id: "registry", label: "Not in any registry", category: "registry", weight: 1, score: 0.5, severity: "low", evidence: "No registry match for that name. Paste the charity's website to analyze it directly." };
  return { id: "registry", label: "Not in any registry", category: "registry", weight: 3, score: 0.35, severity: "medium", evidence: "No matching organization found in ProPublica Nonprofit Explorer. Many real local groups are not listed, so this alone is not proof of a scam." };
}

const STEPS: ProgressStep[] = ["Checking registries...", "Analyzing website...", "Verifying social profiles...", "Scoring..."];

export async function analyze(target: string, onProgress: (s: ProgressStep) => void = () => {}): Promise<AnalysisResult> {
  const n = normalizeInput(target);
  const key = (n.domain ?? n.name!.toLowerCase()) + "|" + n.kind;
  const hit = cache.get(key);
  if (hit) return { ...hit, target: n.raw };

  const errors: string[] = [];
  const signals: Signal[] = [];
  const responded = new Set<string>();
  const extraRed: string[] = [], extraGreen: string[] = [];
  let registry: RegistryResult | null = null;
  let partial = false, hardFail = false, aiSummary: string | null = null, aiAvailable = false;
  let site: { url?: URL; domain: string | null; name?: string } = { url: n.url, domain: n.domain, name: n.name };
  let socialInput: ParsedSocial | null = null;
  let resolvedFrom: string | null = null;
  let socialProfiles: SocialProfile[] = [];

  // Emits every step up to and including `s`, in order, exactly once.
  let emitted = 0;
  const step = (s: ProgressStep) => { const to = STEPS.indexOf(s); while (emitted <= to) onProgress(STEPS[emitted++]); };

  const orgTokens = () => tokensFor(site.domain, (registry as RegistryResult | null)?.name ?? site.name);

  /** Extract the page's social links (plus the input profile, if any) and verify them. */
  const runSocial = async (html: string, pageUrl: URL, light: boolean) => {
    step("Verifying social profiles...");
    const links = extractSocialLinks(html, pageUrl);
    if (socialInput?.kind === "profile" && !links.some((l) => l.platform === socialInput!.platform && l.handle.toLowerCase() === socialInput!.handle.toLowerCase())) links.unshift(socialInput);
    return verifyAll(links, { domain: site.domain, orgTokens: orgTokens() }, { light });
  };
  const addSocial = (profiles: SocialProfile[], asksForMoney: boolean, includePresence = true) => {
    socialProfiles = profiles;
    signals.push(...socialSignals(profiles, { asksForMoney, includePresence }));
    if (profiles.some((p) => p.verdict !== "unverifiable")) responded.add("social"); // blocked platforms don't raise confidence
  };

  const own = async () => {
    const url = site.url!, domain = site.domain!;
    signals.push(...urlSignals(url, domain), lookalikeSignal(domain));
    const [rdap, page, sb] = await Promise.allSettled([lookupDomain(domain), fetchPage(url), checkSafeBrowsing(url.href)]);

    if (rdap.status === "fulfilled") { signals.push(...rdap.value); responded.add("domain"); }
    else errors.push(`Domain age lookup failed: ${(rdap.reason as Error).message}`);

    if (sb.status === "fulfilled" && sb.value) { signals.push(sb.value.signal); hardFail = sb.value.hit; responded.add("reputation"); }
    else if (sb.status === "rejected") errors.push(`Safe Browsing check failed: ${(sb.reason as Error).message}`);

    if (page.status !== "fulfilled" || !page.value.ok || !page.value.finalUrl) {
      const why = page.status === "fulfilled" ? page.value.error : (page.reason as Error).message;
      errors.push(`Website could not be fetched: ${why ?? "unknown error"}`);
      signals.push({ id: "reachable", label: "Website reachable", category: "technical", weight: 2, score: 0.3, severity: "medium", evidence: `The page could not be loaded (${why ?? "unknown error"}). Content checks were skipped.` });
      partial = true;
      return;
    }
    const p: PageFetch = page.value;
    signals.push(...(await technicalSignals(p, domain)));
    responded.add("technical");
    const content = analyzeContent(p.html, p.finalUrl!);
    signals.push(...content.signals);
    responded.add("content");

    // Social verification and the LLM call run in parallel to stay inside the 15s budget.
    const [llmOut, soc] = await Promise.all([
      llmConfigured() ? judgePage(content.excerpt, { domain, registryNote: registry ? JSON.stringify({ found: (registry as RegistryResult).found, name: (registry as RegistryResult).name }) : "not checked" }) : Promise.resolve(null),
      runSocial(p.html, p.finalUrl!, false).catch((e) => { errors.push(`Social check failed: ${(e as Error).message}`); return null; }),
    ]);
    if (soc) addSocial(soc, /donat/i.test(content.text));

    if (!llmOut) errors.push("AI analysis unavailable (not configured).");
    else if (llmOut.ok) {
      signals.push(llmSignal(llmOut.data, llmWeightFor(signals))); // computed after social so the LLM stays ~25%
      extraRed.push(...llmOut.data.redFlags.map((f) => `AI: ${f}`)); extraGreen.push(...llmOut.data.greenFlags.map((f) => `AI: ${f}`));
      aiSummary = llmOut.data.reasoning; aiAvailable = true; responded.add("llm");
    } else errors.push(`AI analysis unavailable (${llmOut.reason}).`);
  };

  /** Registry-verified site: skip heavy analysis, but light-check that its social links belong to the organization. */
  const lightSocial = async () => {
    const page = await fetchPage(site.url!);
    if (!page.ok || !page.finalUrl) { errors.push("Could not load the website to check its social links."); return; }
    addSocial(await runSocial(page.html, page.finalUrl, true), true);
  };

  /** Social profile with no website behind it: assess the profile alone, with low confidence. */
  const socialOnly = async () => {
    step("Verifying social profiles...");
    const prof = await verifyProfile(socialInput!, { domain: null, orgTokens: tokensFor(null, site.name) });
    addSocial([prof], false, false);
    errors.push("No website was found on this profile, so this is a social-only assessment with lower confidence.");
  };

  const work = async () => {
    step("Checking registries...");
    if (n.kind === "social") {
      socialInput = parseSocialUrl(n.url!.href);
      if (socialInput?.kind === "profile") {
        const w = await resolveSocialWebsite(socialInput).catch(() => null);
        let resolved: ReturnType<typeof normalizeInput> | null = null;
        try { resolved = w ? normalizeInput(w) : null; } catch { /* unsafe or invalid target: ignore */ }
        if (resolved?.kind === "url") { site = { url: resolved.url, domain: resolved.domain }; resolvedFrom = socialInput.url; }
        else site = { domain: null, name: socialInput.handle.replace(/^@/, "").replace(/[_.\-]+/g, " ") };
      } else { errors.push("That link goes to a social platform page, not to a profile, so there is nothing to assess."); partial = true; site = { domain: null }; }
    }
    try {
      registry = await lookupRegistry({ name: site.name, domain: site.domain });
      signals.push(registrySignal(registry, !!site.domain));
      responded.add("registry");
    } catch (e) {
      errors.push(`Registry lookup failed: ${(e as Error).message}`);
      partial = true;
    }
    const reg = registry as RegistryResult | null;
    const verified = !!reg?.found && !!reg.domainMatches;
    step("Analyzing website...");
    if (site.url && site.domain) { if (verified) await lightSocial(); else await own(); }
    else if (socialInput?.kind === "profile") await socialOnly();
    step("Verifying social profiles...");
    step("Scoring...");
  };

  let timer: NodeJS.Timeout;
  const timeout = new Promise<void>((r) => { timer = setTimeout(() => { partial = true; errors.push("Timed out after 15s; showing partial results."); r(); }, 15000); });
  await Promise.race([work().catch((e) => { errors.push((e as Error).message); partial = true; }), timeout]);
  clearTimeout(timer!);
  step("Scoring...");

  const snap = [...signals];
  const reg = registry as RegistryResult | null;
  const { score, verdict, confidence } = computeScore(snap, reg, hardFail, responded.size);
  const dedupe = (a: string[]) => [...new Set(a)];
  const redFlags = dedupe([...snap.filter((s) => s.score < 0.5 && s.severity !== "info" && s.id !== "llm" && s.weight > 0 && !s.evidence.startsWith("Unverifiable")).map((s) => s.evidence), ...extraRed]);
  const greenFlags = dedupe([...snap.filter((s) => s.score >= 0.85 && s.weight > 0 && s.id !== "llm").map((s) => s.evidence), ...extraGreen]);
  const safeAlternatives = reg?.found && !reg.domainMatches && site.domain
    ? KNOWN_ORGS.filter((o) => o.ein === reg.id).map((o) => ({ name: o.name, url: `https://${o.domains[0]}` }))
    : [];
  const base = aiSummary ?? `Scored ${score}/100 from ${snap.filter((s) => s.weight > 0).length} weighted signals (${[...responded].join(", ") || "none"}). Confidence is ${confidence}.`;

  const result: AnalysisResult = {
    target: n.raw, kind: n.kind, normalizedDomain: site.domain, verdict, score, confidence,
    source: reg?.found ? (reg.domainMatches ? "registry" : "both") : "analysis",
    registry: reg, signals: snap, socialProfiles, redFlags, greenFlags,
    summary: resolvedFrom ? `Resolved this profile to ${site.domain} and analyzed that site. ${base}` : base,
    aiAvailable, safeAlternatives, checkedAt: new Date().toISOString(), partial, errors,
  };
  if (!partial) cache.set(key, result);
  return result;
}
