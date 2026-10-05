import { useState } from "react";
import { useNavigate } from "react-router-dom";

export const EXAMPLES = ["redcross.org", "St. Jude Children's Research Hospital", "https://instagram.com/unicef"];

export default function SearchBox({ initial = "", compact = false }: { initial?: string; compact?: boolean }) {
  const [value, setValue] = useState(initial);
  const nav = useNavigate();
  const go = (v: string) => { const t = v.trim(); if (t) nav(`/check?target=${encodeURIComponent(t)}`); };
  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); go(value); }} className="flex flex-col sm:flex-row gap-3">
        <label className="sr-only" htmlFor="target">Donation page, charity name, or social profile link</label>
        <input id="target" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Paste a donation page, charity name, or social profile link"
          className={`flex-1 rounded-xl border-2 border-line bg-surface px-4 text-ink placeholder:text-muted focus:border-teal ${compact ? "h-12" : "h-14 text-lg"}`} />
        <button className={`rounded-xl bg-teal px-7 font-display font-bold text-white hover:brightness-110 dark:text-[#06201f] ${compact ? "h-12" : "h-14 text-lg"}`}>Check</button>
      </form>
      {!compact && (
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <span className="text-muted py-1">Try:</span>
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => go(ex)} className="rounded-full border border-line bg-surface px-3 py-1 hover:border-teal">{ex}</button>
          ))}
        </div>
      )}
    </div>
  );
}
