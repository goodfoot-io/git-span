import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { DownloadIcon, GithubAltIcon, LibraryIcon } from '~/components/icons';
import { HERO } from '~/components/marketing/story/copy';

// "GS" ring-and-span mark (see public/logo-negative.svg for the source asset -- the same mark
// public/favicon.svg uses, recolored here to the page's accent purple via currentColor).
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
      className="shrink-0 text-accent"
    >
      <path
        d="M1024 207H442.502C411.417 153.199 353.32 117 286.777 117C187.489 117 107 197.589 107 297C107 396.411 187.489 477 286.777 477C353.32 477 411.417 440.801 442.502 387H1024V1028H0V821H581.498C612.583 874.801 670.68 911 737.223 911C836.511 911 917 830.411 917 731C917 631.589 836.511 551 737.223 551C670.68 551 612.583 587.199 581.498 641H0V4H1024V207Z"
        fill="currentColor"
      />
      <path
        d="M737.223 641C786.867 641 827.111 681.295 827.111 731C827.111 780.706 786.867 821 737.223 821C687.578 821 647.334 780.706 647.334 731C647.334 681.294 687.579 641 737.223 641Z"
        fill="currentColor"
      />
      <path
        d="M286.777 207C336.422 207 376.666 247.294 376.666 297C376.666 346.706 336.421 387 286.777 387C237.133 387 196.889 346.705 196.889 297C196.889 247.294 237.133 207 286.777 207Z"
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
            className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.08em] text-ink-secondary transition-colors hover:text-ink-primary"
          >
            <LibraryIcon size={14} />
            Docs
          </Link>
          <a
            href="https://github.com/goodfoot-io/git-span"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.08em] text-ink-secondary transition-colors hover:text-ink-primary"
          >
            <GithubAltIcon size={14} />
            GitHub
          </a>
          <Link
            to={HERO.primaryCta.href}
            className={`hidden items-center gap-1.5 rounded-radius px-3.5 py-2 font-mono text-xs font-medium whitespace-nowrap transition-colors sm:inline-flex ${
              emphasized
                ? 'border border-accent bg-accent text-white hover:border-accent-hover hover:bg-accent-hover'
                : 'border border-rule text-ink-primary hover:bg-ground-raised'
            }`}
          >
            <DownloadIcon size={14} />
            {HERO.primaryCta.label}
          </Link>
        </nav>
      </div>
    </header>
  );
}
