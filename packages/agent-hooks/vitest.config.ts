import { defineConfig } from 'vitest/config';

function mdPlugin() {
  return {
    name: 'md-loader',
    transform(code: string, id: string) {
      if (id.endsWith('.md')) {
        return `export default ${JSON.stringify(code)};`;
      }
    }
  };
}

export default defineConfig({
  plugins: [mdPlugin()],
  test: {
    include: ['test/**/*.test.ts'],
    globals: false
  }
});
