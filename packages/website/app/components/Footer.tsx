export function Footer() {
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <p className="text-sm text-ink-tertiary">&copy; {new Date().getFullYear()} The git-span contributors</p>
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
