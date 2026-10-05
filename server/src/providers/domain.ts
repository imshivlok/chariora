import type { Signal } from "../../../shared/types.js";
import { KNOWN_ORGS } from "./registry.js";

const TOP = ["redcross", "unicef", "savethechildren", "stjude", "doctorswithoutborders", "feedingamerica", "directrelief", "worldvision", "oxfam", "habitatforhumanity", "unitedway", "salvationarmy", "givedirectly", "worldwildlife", "wfp"];

// Extend as new disasters happen. Registrations shortly after one are a classic scam pattern.
export const DISASTERS = [
  { name: "Turkey-Syria earthquake", date: "2023-02-06" }, { name: "Maui wildfires", date: "2023-08-08" },
  { name: "Hurricane Helene", date: "2024-09-26" }, { name: "Hurricane Milton", date: "2024-10-09" },
  { name: "Los Angeles wildfires", date: "2025-01-07" }, { name: "Myanmar earthquake", date: "2025-03-28" },
  { name: "Texas Hill Country floods", date: "2025-07-04" },
];

export function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export const dehomoglyph = (s: string) => s.toLowerCase().replace(/rn/g, "m").replace(/vv/g, "w").replace(/[0]/g, "o").replace(/[1|]/g, "l").replace(/[5]/g, "s").replace(/[3]/g, "e");

export function lookalikeSignal(domain: string): Signal {
  const label = domain.split(".")[0];
  const flat = label.replace(/-/g, "");
  const owned = KNOWN_ORGS.some((o) => o.domains.includes(domain));
  const base = { id: "lookalike", label: "Lookalike of a well-known charity", category: "domain" as const, weight: 3 };
  if (!owned) {
    for (const brand of TOP) {
      const norm = dehomoglyph(flat);
      const dist = levenshtein(norm, brand);
      if (norm === brand || (brand.length >= 7 && dist <= 2))
        return { ...base, score: 0.05, severity: "high", evidence: `"${domain}" closely imitates "${brand}" (edit distance ${dist}, after normalizing look-alike characters).` };
      if (brand.length >= 6 && norm.includes(brand) && norm !== brand)
        return { ...base, score: 0.2, severity: "high", evidence: `"${domain}" embeds the name "${brand}" with extra words, a common impersonation pattern.` };
    }
  }
  return { ...base, score: 1, severity: "info", evidence: "Domain doesn't imitate any charity on our built-in watch list." };
}

export function disasterSignal(regDate: Date, now = new Date()): Signal | null {
  const hit = DISASTERS.find((d) => {
    const days = (regDate.getTime() - new Date(d.date).getTime()) / 864e5;
    return days >= -3 && days <= 45 && (now.getTime() - regDate.getTime()) / 864e5 < 240;
  });
  return hit ? { id: "disaster-timing", label: "Registered right after a disaster", category: "domain", weight: 2, score: 0.15, severity: "high", evidence: `Domain was registered within 45 days of the ${hit.name} (${hit.date}) and is still new.` } : null;
}

export async function lookupDomain(domain: string, fetchImpl: typeof fetch = fetch): Promise<Signal[]> {
  const res = await fetchImpl(`https://rdap.org/domain/${domain}`, { headers: { Accept: "application/rdap+json" }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`RDAP returned ${res.status}`);
  const data: any = await res.json();
  const out: Signal[] = [];
  const reg = (data.events ?? []).find((e: any) => e.eventAction === "registration")?.eventDate;
  if (reg) {
    const days = Math.floor((Date.now() - new Date(reg).getTime()) / 864e5);
    const score = days < 30 ? 0.05 : days < 90 ? 0.2 : days < 180 ? 0.4 : days < 365 ? 0.6 : days < 730 ? 0.8 : 1;
    out.push({ id: "domain-age", label: "Domain age", category: "domain", weight: 3, score, severity: score < 0.4 ? "high" : score < 0.7 ? "medium" : "info", evidence: `Registered ${new Date(reg).toISOString().slice(0, 10)} (${days} days ago).` });
    const d = disasterSignal(new Date(reg)); if (d) out.push(d);
  }
  const registrar = (data.entities ?? []).find((e: any) => e.roles?.includes("registrar"))?.vcardArray?.[1]?.find((v: any) => v[0] === "fn")?.[3];
  if (registrar) out.push({ id: "registrar", label: "Registrar", category: "domain", weight: 0, score: 1, severity: "info", evidence: `Registered through ${registrar}.` });
  const redacted = /redacted|privacy|withheld/i.test(JSON.stringify(data.entities ?? []));
  out.push({ id: "whois-privacy", label: "WHOIS privacy", category: "domain", weight: 0.5, score: redacted ? 0.6 : 0.9, severity: redacted ? "low" : "info", evidence: redacted ? "Owner details are redacted. Common and often legitimate, but it hides who runs the site." : "Owner details are publicly listed." });
  return out;
}
