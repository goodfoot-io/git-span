import { LogoMark } from '~/components/Header';

export function Footer() {
  return (
    <footer className="border-t border-rule">
      <div className="flex h-16 items-center justify-between px-6 lg:pl-12">
        <div className="flex items-center gap-2 text-ink-tertiary">
          <LogoMark />
          <p className="font-mono text-xs">&copy; {new Date().getFullYear()} Goodfoot Media LLC</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-ink-secondary">
          <a
            href="https://goodfoot.io/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-ink-primary transition-colors"
          >
            goodfoot.io
          </a>
          <span aria-hidden className="text-ink-tertiary">
            &middot;
          </span>
          <a href="mailto:git-span@goodfoot.io" className="hover:text-ink-primary transition-colors">
            git-span@goodfoot.io
          </a>
          <span aria-hidden className="text-ink-tertiary">
            &middot;
          </span>
          <a
            href="https://github.com/goodfoot-io/git-span"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-ink-primary transition-colors"
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
