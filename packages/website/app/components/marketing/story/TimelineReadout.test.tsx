import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TimelineReadout } from './TimelineReadout';

// The timeline readout is a dev-only debug overlay — present only on
// localhost (jsdom's default hostname), and never meant to be read by a
// screen reader or an agent: it duplicates what the caption already says.
// Its aria-hidden is the only thing keeping it out of the accessibility
// tree, and nothing enforces it.

afterEach(cleanup);

describe('TimelineReadout accessibility tree', () => {
  it('keeps the dev readout out of the accessibility tree', () => {
    const { container } = render(<TimelineReadout t={42} />);
    const readout = container.querySelector('.fixed.bottom-3');
    expect(readout).not.toBeNull();
    expect(readout?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('t 42.0')).toBeTruthy();
  });
});
