import { isbot } from 'isbot';
import type { ReactDOMServerReadableStream } from 'react-dom/server';
import { renderToReadableStream } from 'react-dom/server.edge';
import type { EntryContext } from 'react-router';
import { ServerRouter } from 'react-router';

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  entryContext: EntryContext
) {
  let body: ReactDOMServerReadableStream;
  try {
    body = await renderToReadableStream(<ServerRouter context={entryContext} url={request.url} />, {
      signal: request.signal,
      onError(error: unknown) {
        // Stream is already in flight — log the error but we cannot change the status
        console.error(error);
      }
    });
  } catch (e) {
    // Synchronous/pre-stream error — return a 500 before any response is sent
    console.error(e);
    return new Response('Internal Server Error', { status: 500, headers: { 'Content-Type': 'text/plain' } });
  }

  if (isbot(request.headers.get('user-agent') ?? '')) {
    await Promise.race([body.allReady, new Promise((resolve) => setTimeout(resolve, 10_000))]);
  }

  responseHeaders.set('Content-Type', 'text/html');
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode
  });
}
