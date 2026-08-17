import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { DownloadIcon, GithubAltIcon, LibraryIcon } from '~/components/icons';
import { HERO } from '~/components/marketing/story/copy';

// git-span ring-and-span mark (see public/logo-positive.svg for the source asset -- the same
// mark public/favicon.svg uses, recolored here to the page's accent purple via currentColor).
export function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      role="presentation"
      className="shrink-0 text-accent"
    >
      <path
        d="M512 329.143C512 228.154 430.314 146.286 329.55 146.286H174.468C154.315 146.286 137.978 162.659 137.978 182.857C137.978 203.055 154.315 219.429 174.468 219.429H329.55C390.009 219.429 439.02 268.549 439.02 329.143C439.02 389.737 390.009 438.857 329.55 438.857H0V512H329.55C430.314 512 512 430.132 512 329.143Z"
        fill="currentColor"
      />
      <path
        d="M182.45 73.1429L512 73.1429V0L182.45 8.29697e-05C81.6856 8.29697e-05 0 81.868 0 182.857C0 283.846 81.6856 365.714 182.45 365.714H337.532C357.685 365.714 374.022 349.341 374.022 329.143C374.022 308.945 357.685 292.572 337.532 292.572H182.45C121.991 292.572 72.98 243.451 72.98 182.857C72.98 122.264 121.991 73.1429 182.45 73.1429Z"
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
        <Link to="/" aria-label="git-span home" className="flex items-center text-ink-primary">
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
                : 'border border-rule bg-white text-ink-primary hover:bg-ground-raised'
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
