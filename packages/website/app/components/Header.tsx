import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { DownloadIcon, GithubAltIcon, LibraryIcon } from '~/components/icons';
import { HERO } from '~/components/marketing/story/copy';

// git-span ring-and-span mark (see public/logo-positive.svg for the source asset), recolored
// here to the page's accent purple via currentColor.
export function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 464"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      role="presentation"
      className="shrink-0 text-accent"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M305.033 158.857C372.209 158.857 426.667 213.436 426.667 280.762C426.667 348.088 372.209 402.667 305.033 402.667H167.244C156.876 438.111 124.129 464 85.3333 464C38.205 464 0 425.795 0 378.667C0 331.538 38.205 293.333 85.3333 293.333C123.85 293.333 156.405 318.852 167.017 353.905H305.033C345.339 353.905 378.014 321.157 378.014 280.762C378.014 240.366 345.339 207.619 305.033 207.619H201.645C188.21 207.619 177.318 196.703 177.318 183.238C177.318 169.773 188.21 158.857 201.645 158.857H305.033ZM85.3333 332C59.56 332 38.6667 352.893 38.6667 378.667C38.6667 404.44 59.56 425.333 85.3333 425.333C111.107 425.333 132 404.44 132 378.667C132 352.893 111.107 332 85.3333 332Z"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M426.667 0C473.795 0 512 38.205 512 85.3333C512 132.462 473.795 170.667 426.667 170.667C388.15 170.667 355.595 145.148 344.983 110.095H206.967C166.661 110.095 133.986 142.843 133.986 183.238C133.986 223.634 166.661 256.381 206.967 256.381H310.355C323.79 256.381 334.682 267.297 334.682 280.762C334.682 294.227 323.79 305.143 310.355 305.143H206.967C139.791 305.143 85.3334 250.564 85.3333 183.238C85.3333 115.912 139.791 61.3333 206.967 61.3333H344.756C355.124 25.8893 387.871 0 426.667 0ZM426.667 38.6667C400.893 38.6667 380 59.56 380 85.3333C380 111.107 400.893 132 426.667 132C452.44 132 473.333 111.107 473.333 85.3333C473.333 59.56 452.44 38.6667 426.667 38.6667Z"
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
        <Link to="/" aria-label="git-span home" className="flex items-center gap-2.5 text-ink-primary">
          <LogoMark size={34} />
          <span className="font-mono text-base font-semibold tracking-tight">git-span</span>
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
            Install
          </Link>
        </nav>
      </div>
    </header>
  );
}
