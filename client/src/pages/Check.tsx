import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Gauge from "../components/Gauge";
import SearchBox from "../components/SearchBox";
import SocialCard from "../components/SocialCard";
import type { AnalysisResult, Signal } from "../../../shared/types";

const STEPS = ["Checking registries...", "Analyzing website...", "Verifying social profiles...", "Scoring..."];
const CATS: [Signal["category"], string][] = [["registry", "Registry"], ["reputation", "Reputation"], ["domain", "Domain"], ["technical", "Technical"], ["content", "Page content"], ["social", "Social"]];
const SEV: Record<Signal["severity"], string> = { info: "text-green", low: "text-amber", medium: "text-amber", high: "text-red" };

function SignalRow({ s }: { s: Signal }) {
  return (
    <details className="group border-b border-line py-3 last:border-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="font-medium">{s.label}</span>
        <span className={`text-sm font-semibold ${SEV[s.severity]}`}>{Math.round(s.score * 100)}%</span>
      </summary>
      <p className="mt-2 text-sm text-muted">{s.evidence}</p>
    </details>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-line bg-surface p-6"><h2 className="font-display text-xl font-bold">{title}</h2><div className="mt-3">{children}</div></section>;
}

export default function Check() {
  const [params] = useSearchParams();
  const target = params.get("target")?.trim() ?? "";
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reporting, setReporting] = useState(false);

  useEffect(() => { document.title = result ? `${result.verdict} (${result.score}/100): ${result.normalizedDomain ?? result.target} | Chariora` : "Checking... | Chariora"; }, [result]);

  useEffect(() => {
    if (!target) return;
    setResult(null); setError(null); setStep(0);
    const es = new EventSource(`/api/analyze/stream?target=${encodeURIComponent(target)}`);
    es.addEventListener("progress", (e) => setStep(Math.max(0, STEPS.indexOf(JSON.parse((e as MessageEvent).data).step))));
    es.addEventListener("result", (e) => { setResult(JSON.parse((e as MessageEvent).data)); es.close(); });
    es.addEventListener("fail", (e) => { setError(JSON.parse((e as MessageEvent).data).error); es.close(); });
    es.onerror = () => { setError((p) => p ?? "Couldn't reach the Chariora server. Is it running?"); es.close(); };
    return () => es.close();
  }, [target]);

  const copy = async () => { await navigator.clipboard.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 1800); };

  if (!target) return (
    <div className="mx-auto max-w-3xl px-5 py-16"><h1 className="font-display text-3xl font-bold">Nothing to check yet</h1><p className="mt-2 mb-6 text-muted">Enter a donation page, charity name, or social profile link.</p><SearchBox /></div>
  );

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <SearchBox initial={target} compact />
      {error && <div role="alert" className="mt-8 rounded-2xl border-2 border-red p-6"><h1 className="font-display text-2xl font-bold text-red">Couldn't check that</h1><p className="mt-1">{error}</p></div>}

      {!error && !result && (
        <div className="mt-10 flex flex-col items-center gap-8 rounded-3xl border border-line bg-surface p-10" aria-live="polite">
          <Gauge score={null} />
          <ol className="space-y-2">
            {STEPS.map((s, i) => (<li key={s} className={i < step ? "text-green" : i === step ? "font-semibold" : "text-muted"}>{i < step ? "Done: " : ""}{s}</li>))}
          </ol>
        </div>
      )}

      {result && (
        <div className="mt-8 space-y-6">
          <div className="flex flex-col items-center rounded-3xl border border-line bg-surface p-8">
            <Gauge score={result.score} label={result.verdict} size={360} />
            <p className="mt-2 text-sm text-muted">Confidence: {result.confidence}. {result.normalizedDomain ?? result.target}</p>
            <div className="mt-4 rounded-full bg-paper px-4 py-1.5 text-sm font-medium">
              {result.registry?.found ? `Found in IRS registry, EIN ${result.registry.id}` : "Not in any registry - analyzed by Chariora"}
            </div>
          </div>

          {(result.partial || result.errors.some((e) => e.startsWith("No website was found"))) && <div role="status" className="rounded-xl border border-amber p-4 text-sm">{result.partial ? "Partial result. " : ""}{result.errors.filter((e) => !e.startsWith("AI analysis")).join(" ")}</div>}
          {result.registry?.found && !result.registry.domainMatches && result.normalizedDomain && (
            <div role="alert" className="rounded-xl border-2 border-red p-4"><b>Impersonation risk.</b> A real charity with this name exists, but this website could not be confirmed as its own.</div>
          )}

          <div className="grid gap-6 md:grid-cols-2">
            <Card title="Why this score">
              {result.signals.length ? CATS.map(([c, name]) => { const list = result.signals.filter((s) => s.category === c); return list.length ? (
                <div key={c} className="mb-3 last:mb-0"><h3 className="font-display text-sm font-bold text-muted">{name}</h3>{list.map((s) => <SignalRow key={s.id} s={s} />)}</div>
              ) : null; }) : <p className="text-muted">No signals could be collected.</p>}
            </Card>
            <div className="space-y-6">
              <Card title="Red flags">{result.redFlags.length ? <ul className="list-disc space-y-1 pl-5 text-red">{result.redFlags.map((f) => <li key={f}><span className="text-ink">{f}</span></li>)}</ul> : <p className="text-muted">None found so far.</p>}</Card>
              <Card title="Green flags">{result.greenFlags.length ? <ul className="list-disc space-y-1 pl-5 text-green">{result.greenFlags.map((f) => <li key={f}><span className="text-ink">{f}</span></li>)}</ul> : <p className="text-muted">None found so far.</p>}</Card>
            </div>
          </div>

          <Card title="Social profiles"><SocialCard profiles={result.socialProfiles} kind={result.kind} /></Card>
          {result.aiAvailable ? <Card title="AI summary"><p>{result.summary}</p><p className="mt-2 text-xs text-muted">Generated by an AI model from the page text. It contributes at most a quarter of the score.</p></Card>
            : <Card title="Summary"><p>{result.summary}</p><p className="mt-2 text-xs text-muted">AI analysis unavailable for this check; the score uses the other signals only.</p></Card>}
          {result.safeAlternatives.length > 0 && (
            <Card title="Safe alternatives"><ul className="space-y-1">{result.safeAlternatives.map((a) => <li key={a.url}><a className="text-teal underline" href={a.url} target="_blank" rel="noreferrer noopener">{a.name}</a></li>)}</ul></Card>
          )}

          <div className="flex flex-wrap gap-3">
            <button onClick={copy} className="rounded-xl bg-teal px-5 py-2.5 font-display font-bold text-white dark:text-[#06201f]">{copied ? "Link copied" : "Copy link to this report"}</button>
            <button onClick={() => setReporting((v) => !v)} aria-expanded={reporting} className="rounded-xl border border-line bg-surface px-5 py-2.5 font-display font-bold">Report this site</button>
          </div>
          {reporting && (
            <Card title="Report this site">
              <p className="text-sm text-muted">Chariora doesn't file reports for you. These official channels do:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                <li><a className="text-teal underline" href="https://reportfraud.ftc.gov" target="_blank" rel="noreferrer noopener">FTC ReportFraud (US)</a></li>
                <li><a className="text-teal underline" href="https://www.ic3.gov" target="_blank" rel="noreferrer noopener">FBI IC3 (US internet crime)</a></li>
                <li><a className="text-teal underline" href="https://safebrowsing.google.com/safebrowsing/report_phish/" target="_blank" rel="noreferrer noopener">Google Safe Browsing: report phishing</a></li>
              </ul>
              <p className="mt-2 text-xs text-muted">If you already paid, contact your bank or card issuer right away.</p>
            </Card>
          )}
          <p className="text-xs text-muted">Checked {new Date(result.checkedAt).toLocaleString()}. Risk indicator, not a legal finding.</p>
        </div>
      )}
    </div>
  );
}
