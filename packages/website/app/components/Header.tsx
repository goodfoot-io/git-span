import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { HERO } from '~/components/marketing/story/copy';

// Abstract "span across a box" mark: a rounded square (the two disconnected sides of a
// repository) crossed by a single accent-colored line that runs slightly past both edges (the
// span linking them). Doubles as the favicon (see public/favicon.svg) at larger size.
export function LogoMark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      role="presentation"
      className="shrink-0"
    >
      <rect x="3.25" y="3.25" width="13.5" height="13.5" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <line x1="0.5" y1="10" x2="19.5" y2="10" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function Header() {
  // On the homepage the hero shows its own accent-filled install CTA in the same first
  // viewport, so the header's copy stays a quiet outline until the hero scrolls away --
  // exactly one bold violet CTA on screen at a time. Every other page fills immediately.
  const { pathname } = useLocation();
  const onStory = pathname === '/';
  const [pastHero, setPastHero] = useState(false);
  useEffect(() => {
    if (!onStory) return;
    const measure = () => setPastHero(window.scrollY > window.innerHeight * 0.75);
    measure();
    window.addEventListener('scroll', measure, { passive: true });
    return () => window.removeEventListener('scroll', measure);
  }, [onStory]);
  const emphasized = !onStory || pastHero;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-rule bg-ground/80 backdrop-blur-sm">
      <div className="flex h-16 items-center justify-between px-6 lg:pl-12">
        <Link to="/" className="flex items-center gap-2 text-ink-primary">
          <LogoMark />
          <span className="font-mono text-sm font-medium tracking-tight whitespace-nowrap">git-span</span>
        </Link>
        <nav className="flex items-center gap-4 sm:gap-6">
          <Link
            to="/docs"
            className="font-mono text-xs uppercase tracking-[0.08em] text-ink-secondary transition-colors hover:text-ink-primary"
          >
            Docs
          </Link>
          <a
            href="https://github.com/goodfoot-io/git-span"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs uppercase tracking-[0.08em] text-ink-secondary transition-colors hover:text-ink-primary"
          >
            GitHub
          </a>
          <Link
            to={HERO.primaryCta.href}
            className={`hidden items-center rounded-radius px-3.5 py-2 font-mono text-xs font-medium whitespace-nowrap transition-colors sm:inline-flex ${
              emphasized
                ? 'border border-accent bg-accent text-white hover:border-accent-hover hover:bg-accent-hover'
                : 'border border-rule text-ink-primary hover:bg-ground-raised'
            }`}
          >
            {HERO.primaryCta.label}
          </Link>
        </nav>
      </div>
    </header>
  );
}
