import path from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import fumadocsMdx from 'fumadocs-mdx/vite';
import { defineConfig } from 'vite';

const optimizeInclude = [
  'react',
  'react-dom',
  'react-dom/client',
  'react-dom/server',
  'react-dom/server.edge',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'fumadocs-ui/provider/react-router',
  'fumadocs-ui/layouts/docs',
  'fumadocs-ui/layouts/docs/page'
];

export default defineConfig(async ({ command }) => ({
  // The V8 engine GLB is loaded via a `?url` import from EngineScene.ts; Vite needs to know it's
  // a static asset (not a module to parse) even though the `?url` suffix already forces URL
  // handling in dev.
  assetsInclude: ['**/*.glb'],
  define: {
    'process.env.NODE_ENV': JSON.stringify(command === 'build' ? 'production' : 'development')
  },
  plugins: [
    ...(await fumadocsMdx()),
    cloudflare({
      viteEnvironment: { name: 'ssr' },
      configPath: command === 'serve' ? './wrangler.dev.toml' : './wrangler.toml'
    }),
    tailwindcss(),
    reactRouter()
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '~': path.resolve(__dirname, './app'),
      collections: path.resolve(__dirname, './.source')
    }
  },
  optimizeDeps: {
    include: optimizeInclude
  },
  environments: {
    ssr: {
      optimizeDeps: {
        include: optimizeInclude
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['local.git-span.com'],
    headers: {
      'Cache-Control': 'no-store, max-age=0'
    }
  }
}));
