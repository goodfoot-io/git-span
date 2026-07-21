import { LogoMark } from '~/components/Header';

export function Footer() {
  return (
    <footer className="border-t border-rule">
      <div className="flex h-16 items-center justify-between px-6 lg:pl-12">
        <div className="flex items-center gap-2 text-ink-tertiary">
          <LogoMark />
          <p className="font-mono text-xs">&copy; {new Date().getFullYear()} The git-span contributors</p>
        </div>
        <a
          href="https://github.com/goodfoot-io/git-span"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-ink-secondary hover:text-ink-primary transition-colors"
        >
          GitHub
        </a>
      </div>
    </footer>
  );
}
