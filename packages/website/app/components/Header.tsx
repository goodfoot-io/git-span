import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { HERO } from '~/components/marketing/story/copy';

// "GS" ring-and-span mark (see public/logo-negative.svg for the source asset). Doubles as
// the favicon (see public/favicon.svg) at larger size.
export function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      role="presentation"
      className="shrink-0"
    >
      <path
        d="M1024 204.8H484.598C449.187 143.586 383.004 102.4 307.2 102.4C194.092 102.4 102.4 194.092 102.4 307.2C102.4 420.308 194.092 512 307.2 512C383.004 512 449.187 470.814 484.598 409.6H1024V1024H0V819.2H539.402C574.813 880.414 640.996 921.6 716.8 921.6C829.908 921.6 921.6 829.908 921.6 716.8C921.6 603.692 829.908 512 716.8 512C640.996 512 574.813 553.186 539.402 614.4H0V0H1024V204.8Z"
        fill="currentColor"
      />
      <path
        d="M716.8 614.4C773.354 614.4 819.2 660.246 819.2 716.8C819.2 773.354 773.354 819.2 716.8 819.2C660.246 819.2 614.4 773.354 614.4 716.8C614.4 660.246 660.246 614.4 716.8 614.4Z"
        fill="currentColor"
      />
      <path
        d="M307.2 204.8C363.754 204.8 409.6 250.646 409.6 307.2C409.6 363.754 363.754 409.6 307.2 409.6C250.646 409.6 204.8 363.754 204.8 307.2C204.8 250.646 250.646 204.8 307.2 204.8Z"
        fill="currentColor"
      />
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
        <Link to="/" className="flex items-center text-ink-primary">
          <LogoMark size={34} />
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
