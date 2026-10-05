import { useEffect } from "react";
import { Link } from "react-router-dom";

const Page = ({ title, children }: { title: string; children: React.ReactNode }) => {
  useEffect(() => { document.title = `${title} | Chariora`; }, [title]);
  return (
  <div className="mx-auto max-w-3xl px-5 py-12"><h1 className="font-display text-4xl font-extrabold">{title}</h1><div className="mt-6 space-y-4 text-lg text-muted">{children}</div></div>
  );
};

export const HowItWorks = () => (
  <Page title="How Chariora works">
    <p>First we search public nonprofit registries. A charity existing in a registry does not prove the website you were sent to belongs to it, so we also check that the domain matches.</p>
    <p>When there is no match, or the domain differs, we analyze the site itself. Each signal gets a weight, and the weighted total becomes the 0-100 score.</p>
    <p>If a source can't be reached, we say so and lower our confidence instead of guessing.</p>
  </Page>
);
export const About = () => (
  <Page title="About">
    <p>Chariora helps donors tell real charities from convincing copies, especially in the rush after a disaster.</p>
    <p>Results are risk indicators, not legal findings. Verify directly with the registry or the charity.</p>
  </Page>
);
export const Extension = () => (
  <Page title="Chariora browser extension">
    <p>The extension checks the site you are on from the toolbar, and shows a small warning banner on donation pages that look Suspicious or worse. It sends only the site address to Chariora, never the page content.</p>
    <a href="/chariora-extension.zip" download className="inline-block rounded-xl bg-teal px-6 py-3 font-display font-bold text-white no-underline dark:text-[#06201f]">Download the extension (.zip)</a>
    <h2 className="pt-4 font-display text-2xl font-bold text-ink">Install in Chrome (2 minutes)</h2>
    <ol className="list-decimal space-y-2 pl-6">
      <li>Unzip the download to a folder you will keep.</li>
      <li>Open <code className="rounded bg-surface px-1.5 py-0.5 text-ink">chrome://extensions</code> and switch on <b className="text-ink">Developer mode</b>.</li>
      <li>Click <b className="text-ink">Load unpacked</b> and choose the unzipped folder.</li>
      <li>Pin Chariora from the puzzle-piece menu, then click it on any site.</li>
    </ol>
    <p className="text-base">Using a self-hosted copy? Open the popup, expand <b className="text-ink">Advanced</b>, and set the API server and web app URLs.</p>
  </Page>
);
export const NotFound = () => (
  <Page title="Page not found"><p>That page doesn't exist. <Link to="/" className="text-teal underline">Go back to the homepage</Link> and run a check.</p></Page>
);
