import { useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useParams } from "react-router-dom";
import Home from "./pages/Home";
import Check from "./pages/Check";
import { HowItWorks, About, Extension, NotFound } from "./pages/Static";

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-display text-2xl font-extrabold tracking-tight">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="9" fill="var(--teal)" /><path d="M6 21a10 10 0 0 1 20 0" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" /><path d="M16 21l5-8" stroke="#fff" strokeWidth="3" strokeLinecap="round" /></svg>
      Chariora
    </Link>
  );
}

function PrettyRedirect() {
  const { encodedTarget } = useParams();
  return <Navigate replace to={`/check?target=${encodeURIComponent(decodeURIComponent(encodedTarget ?? ""))}`} />;
}

export default function App() {
  const [dark, setDark] = useState(document.documentElement.classList.contains("dark"));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
    setDark(next);
  };
  const link = ({ isActive }: { isActive: boolean }) => `hover:text-teal ${isActive ? "text-teal" : "text-muted"}`;
  return (
    <>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <nav className="flex items-center gap-5 text-sm font-medium">
          <NavLink to="/how-it-works" className={link}>How it works</NavLink>
          <NavLink to="/extension" className={link}>Extension</NavLink>
          <NavLink to="/about" className={link}>About</NavLink>
          <button onClick={toggle} aria-label="Toggle dark mode" className="rounded-lg border border-line bg-surface px-2.5 py-1.5">{dark ? "Light" : "Dark"}</button>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/check" element={<Check />} />
          <Route path="/check/:encodedTarget" element={<PrettyRedirect />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/extension" element={<Extension />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="mt-24 border-t border-line">
        <div className="mx-auto max-w-6xl px-5 py-10 text-sm text-muted">
          <Logo />
          <p className="mt-4 max-w-2xl">Chariora results are risk indicators, not legal findings. Always confirm a charity directly with its official registry or by contacting it before you donate.</p>
        </div>
      </footer>
    </>
  );
}
