import type { MDXComponents } from 'mdx/types';

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    Term: ({ children }: { children: React.ReactNode }) => (
      <em className="font-semibold text-accent not-italic">{children}</em>
    ),
    ...components
  };
}
