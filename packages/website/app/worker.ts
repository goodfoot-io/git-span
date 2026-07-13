import { createRequestHandler } from 'react-router';

const rrHandler = createRequestHandler(
  () => import('virtual:react-router/server-build').then((m) => m.default),
  import.meta.env.MODE
);

export default {
  async fetch(request: Request): Promise<Response> {
    return rrHandler(request);
  }
} satisfies ExportedHandler;
