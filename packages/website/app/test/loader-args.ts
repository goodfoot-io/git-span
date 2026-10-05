import { type LoaderFunctionArgs, type Params, RouterContextProvider } from 'react-router';

interface LoaderArgsOptions {
  params?: Params;
  method?: string;
}

/**
 * Loader arguments for a direct loader call against `href` (an absolute URL),
 * shaped like a real route hit: the request and normalized url agree, and the
 * context is a fresh, empty router context.
 */
export function loaderArgs(href: string, { params = {}, method = 'GET' }: LoaderArgsOptions = {}): LoaderFunctionArgs {
  const url = new URL(href);
  return {
    request: new Request(url, { method }),
    url,
    pattern: '',
    params,
    context: new RouterContextProvider()
  };
}
