import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import SearchBox from "../components/SearchBox";
import Gauge from "../components/Gauge";

const DEMO = [{ s: 12, l: "Likely Fake" }, { s: 52, l: "Suspicious" }, { s: 91, l: "Verified Charity" }];

const problems = [
  ["Disaster-day clones", "Fake relief pages often appear within hours of a hurricane, quake, or flood, riding the surge of giving."],
  ["Payments you can't trace", "Gift cards, crypto-only and wire transfers are favorites because the money can't be recovered."],
  ["Borrowed identities", "Real charity logos and names are copied onto brand-new domains that look almost right."],
];
const steps = [
  ["Registry check", "We look the organization up in public nonprofit records like IRS data, and confirm the website actually belongs to it."],
  ["Site and social analysis", "We inspect the domain, the page and the linked social profiles for template copy, missing details and pressure tactics."],
  ["Verdict", "You get a 0-100 score, a plain-language verdict, and every signal behind it."],
];
const features = [
  ["Registry lookup", "Matches the charity and its site against public records."],
  ["Template detection", "Spots placeholder text and copy-pasted donation pages."],
  ["Social verification", "Checks whether linked profiles are established and link back."],
  ["Payment red flags", "Warns about gift-card, crypto-only and wire requests."],
  ["Impersonation alerts", "Flags real charity names on the wrong domain."],
  ["Shareable reports", "Every result has a link anyone can open."],
];
const faqs = [
  ["Can Chariora prove a charity is a scam?", "No. Results are risk indicators, not legal findings. Use them as a reason to look closer."],
  ["A real charity scored low. Why?", "Small or new local groups often aren't in registries. Contact them directly or ask for their registration number."],
  ["Do you store what I check?", "Results are cached by domain for 24 hours to keep checks fast. Nothing is tied to you."],
];

export default function Home() {
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((n) => (n + 1) % DEMO.length), 3200); return () => clearInterval(t); }, []);
  return (
    <>
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pt-10 pb-8 lg:grid-cols-[1.25fr_1fr]">
        <div>
          <h1 className="font-display text-5xl font-extrabold leading-[1.02] tracking-tight sm:text-6xl">Is this donation page real, or a copy?</h1>
          <p className="mt-5 max-w-xl text-lg text-muted">Paste a link, a charity name, or a social profile. Chariora checks public registries and the page itself, then tells you how much to trust it and why.</p>
          <div className="mt-8"><SearchBox /></div>
          <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-3 text-sm">
            {[["Public registries", "checked first"], ["Every signal", "explained"], ["Free", "no account"]].map(([a, b]) => (
              <div key={a}><dt className="inline font-semibold">{a}</dt> <dd className="inline text-muted">{b}</dd></div>
            ))}
          </dl>
        </div>
        <div className="flex justify-center rounded-3xl border border-line bg-surface p-8" aria-hidden>
          <Gauge score={DEMO[i].s} label={DEMO[i].l} size={320} />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20">
        <h2 className="font-display text-3xl font-bold">Why donors get fooled</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {problems.map(([t, d]) => (
            <div key={t} className="border-l-4 border-red pl-5"><h3 className="font-display text-xl font-bold">{t}</h3><p className="mt-2 text-muted">{d}</p></div>
          ))}
        </div>
      </section>

      <section className="bg-surface py-20">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="font-display text-3xl font-bold">How it works</h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {steps.map(([t, d], n) => (
              <li key={t}><span className="font-display text-5xl font-extrabold text-teal">{n + 1}</span><h3 className="mt-2 font-display text-xl font-bold">{t}</h3><p className="mt-2 text-muted">{d}</p></li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20">
        <h2 className="font-display text-3xl font-bold">What it checks</h2>
        <div className="mt-8 grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(([t, d]) => (<div key={t}><h3 className="font-display text-lg font-bold">{t}</h3><p className="text-muted">{d}</p></div>))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5">
        <div className="grid items-center gap-8 rounded-3xl bg-ink p-10 text-paper md:grid-cols-2">
          <div>
            <h2 className="font-display text-3xl font-bold">Check pages as you browse</h2>
            <p className="mt-3 opacity-80">The Chariora extension flags suspicious donation pages while you're on them. Download it, load it into Chrome in two minutes, and it works with this same server.</p>
            <Link to="/extension" className="mt-6 inline-block rounded-xl bg-paper px-6 py-3 font-display font-bold text-ink">Get the extension</Link>
          </div>
          <div className="rounded-2xl bg-paper p-4 text-ink" aria-hidden>
            <div className="mb-3 flex gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-red" /><i className="h-2.5 w-2.5 rounded-full bg-amber" /><i className="h-2.5 w-2.5 rounded-full bg-green" /></div>
            <div className="flex items-center gap-4 rounded-xl border border-line bg-surface p-3"><div className="h-12 w-12 rounded-full bg-amber/30 grid place-items-center font-bold text-amber">48</div><div><b className="font-display">Suspicious - Verify Before Donating</b><div className="text-xs text-muted">hurricane-relief-now.top</div></div></div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-5 py-20">
        <h2 className="font-display text-3xl font-bold">Questions</h2>
        <div className="mt-6 divide-y divide-line border-y border-line">
          {faqs.map(([q, a]) => (
            <details key={q} className="group py-4"><summary className="cursor-pointer list-none font-display text-lg font-bold">{q}</summary><p className="mt-2 text-muted">{a}</p></details>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-5 text-center">
        <h2 className="font-display text-3xl font-bold">Check before you give</h2>
        <div className="mt-6"><SearchBox compact /></div>
      </section>
    </>
  );
}
