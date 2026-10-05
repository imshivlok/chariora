import tls from "node:tls";
import { parse } from "tldts";
import type { Signal } from "../../../shared/types.js";
import type { PageFetch } from "../safeFetch.js";
import { assertPublicHost } from "../safeFetch.js";

export function tlsInfo(host: string): Promise<{ authorized: boolean; issuer?: string; daysLeft?: number; error?: string; unreachable?: boolean }> {
  return new Promise((resolve) => {
    const s = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 5000 }, () => {
      const c = s.getPeerCertificate();
      resolve({ authorized: s.authorized, issuer: [c.issuer?.O ?? c.issuer?.CN].flat().join(", ") || undefined, daysLeft: Math.round((new Date(c.valid_to).getTime() - Date.now()) / 864e5), error: s.authorizationError ? String(s.authorizationError) : undefined });
      s.end();
    });
    s.on("error", (e) => resolve({ authorized: false, error: e.message, unreachable: true })); // connection failure, not a certificate verdict
    s.on("timeout", () => { s.destroy(); resolve({ authorized: false, error: "timeout", unreachable: true }); });
  });
}

export async function technicalSignals(page: PageFetch, startDomain: string, tlsImpl = tlsInfo): Promise<Signal[]> {
  const out: Signal[] = [];
  const finalHost = page.finalUrl?.hostname;
  const finalDomain = finalHost ? parse(finalHost).domain : null;

  const hops = page.chain.length - 1;
  const crossSite = !!finalDomain && finalDomain !== startDomain;
  out.push({ id: "redirects", label: "Redirect behavior", category: "technical", weight: 1.5, score: crossSite ? 0.25 : hops > 2 ? 0.5 : 1, severity: crossSite ? "high" : hops > 2 ? "medium" : "info",
    evidence: crossSite ? `The link ends up on a different site (${finalDomain}).` : hops ? `${hops} redirect(s), staying on the same site.` : "No redirects." });

  const h = page.headers;
  const checks: [string, boolean][] = [["HSTS", !!h["strict-transport-security"]], ["CSP", !!h["content-security-policy"]], ["X-Content-Type-Options", !!h["x-content-type-options"]], ["Clickjacking protection", !!(h["x-frame-options"] || /frame-ancestors/.test(h["content-security-policy"] ?? ""))]];
  const n = checks.filter(([, ok]) => ok).length;
  out.push({ id: "sec-headers", label: "Security headers", category: "technical", weight: 1, score: 0.3 + n * 0.175, severity: n === 0 ? "low" : "info", evidence: `${n}/4 present. ${checks.map(([k, ok]) => `${k}: ${ok ? "yes" : "no"}`).join(", ")}. Many small charities skip these, so the weight is low.` });

  if (finalHost && page.finalUrl?.protocol === "https:") {
    try {
      await assertPublicHost(finalHost);
      const t = await tlsImpl(finalHost);
      if (t.unreachable) return out; // could not connect: say nothing rather than call it a bad certificate
      const bad = !t.authorized || (t.daysLeft ?? 1) < 0;
      out.push({ id: "tls", label: "TLS certificate", category: "technical", weight: 1.5, score: bad ? 0 : 1, severity: bad ? "high" : "info",
        evidence: bad ? `Certificate problem: ${t.error ?? "expired"}.` : `Valid certificate from ${t.issuer ?? "unknown issuer"}, ${t.daysLeft} days left. Free certificates are normal and not a trust signal on their own.` });
    } catch { /* host blocked; skip */ }
  }
  return out;
}
