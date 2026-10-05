import type { RegistryResult } from "../../../shared/types.js";

interface KnownOrg { name: string; ein: string; domains: string[] }

// Small built-in list used to confirm a domain belongs to a registry entry.
// ProPublica does not expose a website field, so this is the v1 domain-match source.
export const KNOWN_ORGS: KnownOrg[] = [
  { name: "American National Red Cross", ein: "53-0196605", domains: ["redcross.org"] },
  { name: "St. Jude Children's Research Hospital", ein: "62-0646012", domains: ["stjude.org"] },
  { name: "Doctors Without Borders USA", ein: "13-3433452", domains: ["doctorswithoutborders.org", "msf.org"] },
  { name: "Save the Children Federation", ein: "06-0726487", domains: ["savethechildren.org"] },
  { name: "UNICEF USA", ein: "13-1760110", domains: ["unicefusa.org", "unicef.org"] },
  { name: "Feeding America", ein: "36-3673599", domains: ["feedingamerica.org"] },
  { name: "Direct Relief", ein: "95-1831116", domains: ["directrelief.org"] },
];

interface PPOrg { ein: number; name: string; city?: string; state?: string; strein?: string }

const STOP = new Set(["the", "of", "and", "inc", "foundation", "fund", "org", "charity", "relief", "help", "for", "usa"]);
const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t && !STOP.has(t));

export function nameSimilarity(a: string, b: string): number {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  A.forEach((t) => B.has(t) && hit++);
  return hit / Math.max(A.size, B.size);
}

export async function lookupRegistry(opts: { name?: string; domain?: string | null }, fetchImpl: typeof fetch = fetch): Promise<RegistryResult> {
  const known = opts.domain ? KNOWN_ORGS.find((o) => o.domains.includes(opts.domain!)) : undefined;
  const query = known?.name ?? opts.name ?? (opts.domain ? opts.domain.split(".")[0].replace(/[-_]/g, " ") : "");
  if (!query) return { found: false };

  const res = await fetchImpl(`https://projects.propublica.org/nonprofits/api/v2/search.json?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": "Chariora/0.1 (charity verification)" },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`ProPublica returned ${res.status}`);
  const data = (await res.json()) as { organizations?: PPOrg[] };
  const orgs = data.organizations ?? [];

  const ranked = orgs
    .map((o) => ({ o, sim: nameSimilarity(query, o.name) }))
    .sort((a, b) => b.sim - a.sim)[0];
  // Known-org EIN match is exact; otherwise require strong name overlap.
  const exact = known ? orgs.find((o) => String(o.ein).padStart(9, "0") === known.ein.replace("-", "")) : undefined;
  const pick = exact ?? (ranked && ranked.sim >= 0.67 ? ranked.o : undefined);
  if (!pick) return { found: false };

  const ein = String(pick.ein).padStart(9, "0");
  const fmtEin = `${ein.slice(0, 2)}-${ein.slice(2)}`;
  return {
    found: true,
    name: pick.name,
    id: fmtEin,
    country: "US",
    trustPercent: known ? 90 : 60, // Phase 3 derives this from filing history
    url: `https://projects.propublica.org/nonprofits/organizations/${ein}`,
    domainMatches: !!known && known.ein === fmtEin,
  };
}
