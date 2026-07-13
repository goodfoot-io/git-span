import type { MetaFunction } from 'react-router';
import { Link } from 'react-router';

export const meta: MetaFunction = () => [
  { title: 'git-span -- Semantic code annotations for git' },
  {
    name: 'description',
    content:
      'Git-native code annotations that ship with every commit. Keep context where it belongs -- in your source tree, not your brain.'
  }
];

export default function Index() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-6">
      <div className="max-w-2xl text-center">
        <h1 className="text-5xl font-bold tracking-tight text-ink-primary">
          Git-native code annotations
          <br />
          <span className="text-accent">that ship with every commit</span>
        </h1>
        <p className="mt-6 text-lg text-ink-secondary leading-relaxed">
          git-span lets you attach semantic annotations to regions of code, persist them alongside your source files,
          and review them as your project evolves. No external service, no sync, no setup -- just plain files in your
          repository.
        </p>
        <div className="mt-10">
          <Link
            to="/docs"
            className="inline-flex items-center rounded-radius bg-accent px-6 py-3 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
          >
            Read the docs
          </Link>
        </div>
      </div>
    </div>
  );
}
