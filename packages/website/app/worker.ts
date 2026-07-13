import { createRequestHandler } from 'react-router';

// React Router v8's virtual:react-router/server-build module exports individual
// named fields (routes, assets, entry, ssr, etc.) matching the ServerBuild
// interface — there is no default export. Pass the module directly so
// createRequestHandler receives the full ServerBuild shape.
const rrHandler = createRequestHandler(() => import('virtual:react-router/server-build'));

export default {
  async fetch(request: Request): Promise<Response> {
    return rrHandler(request);
  }
} satisfies ExportedHandler;
