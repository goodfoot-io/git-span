import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHASE_COPY } from './copy';
import { EngineStage } from './EngineStage';
import { deriveScene } from './scene';

// The engine column is decoration for anyone who reads the page rather than
// watches it: the WebGL canvas and the technical figure label must stay out of
// the accessibility tree, while the per-phase caption — the same information in
// text form — must stay in it. Nothing enforces this today; the current markup
// is correct by authoring convention, and a regression would ship silently.

// three.js never loads under jsdom. The effect's dynamic import is stubbed so
// the component settles deterministically instead of exercising the real WebGL
// boot path against a nonexistent context.
vi.mock('./engine/EngineScene', () => ({
  EngineScene: class {
    async load() {}
    dispose() {}
    resize() {}
    setFrame() {}
    setHeroIdle() {}
    setReducedMotion() {}
  }
}));

beforeEach(() => {
  // jsdom implements neither matchMedia (read by prefersReducedMotion) nor
  // ResizeObserver (wired up once the engine reports ready).
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EngineStage accessibility tree', () => {
  // A mid-timeline scene exercises the non-hero label branch.
  const scene = deriveScene(50);

  it('keeps the WebGL container out of the accessibility tree', () => {
    const { container } = render(<EngineStage scene={scene} />);
    const canvasHost = container.querySelector('div.absolute.inset-0');
    expect(canvasHost).not.toBeNull();
    expect(canvasHost?.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps the technical figure label out of the accessibility tree', () => {
    render(<EngineStage scene={scene} />);
    const label = scene.phase.id === 'hero' ? 'Assembled view' : scene.phase.label;
    expect(screen.getByText(label.toUpperCase()).getAttribute('aria-hidden')).toBe('true');
  });

  it('exposes the per-phase caption through the live region', () => {
    render(<EngineStage scene={scene} />);
    const caption = PHASE_COPY[scene.phase.id].caption;
    // aria-live="polite" implies role="status"; the caption must be reachable
    // through the tree, not only as raw text in the container.
    expect(screen.getByRole('status').textContent).toBe(caption);
  });
});
