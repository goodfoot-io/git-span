import { useEffect, useState } from 'react';

// SSR-safe media query hook: the initial render (server and first client paint) always reports
// `false`, then an effect subscribes to the real value on mount so hydration matches. Used to
// gate client-only, viewport-dependent work (e.g. not booting the three.js engine on phones).
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);

    const listener = (event: MediaQueryListEvent) => setMatches(event.matches);
    mql.addEventListener('change', listener);
    return () => mql.removeEventListener('change', listener);
  }, [query]);

  return matches;
}
