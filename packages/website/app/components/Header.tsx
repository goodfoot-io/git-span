import { Link } from 'react-router';

export function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-rule bg-ground/80 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <Link to="/" className="text-lg font-bold text-ink-primary tracking-tight">
          git-span
        </Link>
        <nav className="flex items-center gap-6">
          <Link to="/docs" className="text-sm text-ink-secondary hover:text-ink-primary transition-colors">
            Docs
          </Link>
          <a
            href="https://github.com/goodfoot-io/git-span"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-ink-secondary hover:text-ink-primary transition-colors"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
