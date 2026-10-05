import type { Platform, SocialProfile } from "../../../shared/types";

const BRAND: Record<Platform, { name: string; bg: string; glyph: string }> = {
  instagram: { name: "Instagram", bg: "#C13584", glyph: "IG" }, facebook: { name: "Facebook", bg: "#1877F2", glyph: "f" },
  x: { name: "X", bg: "#111111", glyph: "X" }, youtube: { name: "YouTube", bg: "#E02D2D", glyph: "\u25B6" },
  tiktok: { name: "TikTok", bg: "#161823", glyph: "TT" }, linkedin: { name: "LinkedIn", bg: "#0A66C2", glyph: "in" },
  telegram: { name: "Telegram", bg: "#229ED9", glyph: "TG" }, whatsapp: { name: "WhatsApp", bg: "#25A244", glyph: "WA" },
};
const CHIP: Record<SocialProfile["verdict"], string> = {
  established: "border-green text-green", suspicious: "border-red text-red", unverifiable: "border-line text-muted",
};

function fmt(n: number) { return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n); }

export default function SocialCard({ profiles, kind }: { profiles: SocialProfile[]; kind: string }) {
  if (!profiles.length)
    return <p className="text-muted">{kind === "social" ? "This link isn't a profile we can assess." : "No social media links were found on this page."}</p>;
  return (
    <ul className="divide-y divide-line">
      {profiles.map((p) => {
        const b = BRAND[p.platform];
        const details = [
          p.reciprocalLink === true && "Links back to the site", p.reciprocalLink === false && "Bio points to a different site",
          p.reachable === false && "Profile not found", p.ageDays !== undefined && `${p.ageDays} days old`, p.followers !== undefined && `${fmt(p.followers)} followers`,
        ].filter(Boolean);
        return (
          <li key={p.platform + p.handle + p.url} className="flex gap-3 py-3 first:pt-0 last:pb-0">
            <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-bold text-white" style={{ background: b.bg }}>{b.glyph}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <a href={p.url} target="_blank" rel="noreferrer noopener" className="truncate font-medium hover:text-teal hover:underline">
                  {b.name}{p.handle ? ` ${p.handle.startsWith("@") ? p.handle : "@" + p.handle}` : " (homepage link)"}
                </a>
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${CHIP[p.verdict]}`}>{p.verdict}</span>
              </div>
              {details.length > 0 && <p className="mt-0.5 text-xs text-muted">{details.join(" \u2022 ")}</p>}
              {p.notes && <p className="mt-1 text-sm text-muted">{p.notes}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
