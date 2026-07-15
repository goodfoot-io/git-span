export type PhaseId = 'hero' | 'change' | 'failure' | 'traverse' | 'second' | 'span' | 'related' | 'success';

export interface Phase {
  id: PhaseId;
  label: string;
  scrollVh: number;
  start: number;
  end: number;
}

export interface SceneState {
  t: number;
  phase: Phase;
  phaseIndex: number;
  local: number;
}

interface PhaseWeight {
  id: PhaseId;
  label: string;
  scrollVh: number;
}

const PHASE_WEIGHTS: readonly PhaseWeight[] = [
  { id: 'hero', label: 'Hero', scrollVh: 1 },
  { id: 'change', label: 'First change', scrollVh: 1.5 },
  { id: 'failure', label: 'Failed integration', scrollVh: 1.5 },
  { id: 'traverse', label: 'Reset and traversal', scrollVh: 1 },
  { id: 'second', label: 'Second change', scrollVh: 1 },
  { id: 'span', label: 'Span appears', scrollVh: 1 },
  { id: 'related', label: 'Related changes', scrollVh: 1.5 },
  { id: 'success', label: 'Success', scrollVh: 0.5 }
];

export const STORY_SCROLL_VH: number = PHASE_WEIGHTS.reduce((sum, phase) => sum + phase.scrollVh, 0);

export const TIMELINE: readonly Phase[] = (() => {
  const totalWeight = STORY_SCROLL_VH;
  let cursor = 0;
  return PHASE_WEIGHTS.map((phase) => {
    const start = (cursor / totalWeight) * 100;
    cursor += phase.scrollVh;
    const end = (cursor / totalWeight) * 100;
    return { id: phase.id, label: phase.label, scrollVh: phase.scrollVh, start, end };
  });
})();

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function ramp(v: number, a: number, b: number): number {
  return clamp01((v - a) / (b - a));
}

export function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

export function timelineFromScroll(firstStepTop: number, vh: number): number {
  return clamp01((vh - firstStepTop) / (STORY_SCROLL_VH * vh)) * 100;
}

export function phaseIndexAt(t: number): number {
  if (t <= 0) return 0;
  if (t >= 100) return TIMELINE.length - 1;
  for (let i = 0; i < TIMELINE.length; i++) {
    const phase = TIMELINE[i];
    if (t >= phase.start && t < phase.end) return i;
  }
  return TIMELINE.length - 1;
}

export function deriveScene(t: number): SceneState {
  const phaseIndex = phaseIndexAt(t);
  const phase = TIMELINE[phaseIndex];
  const local = clamp01((t - phase.start) / (phase.end - phase.start));
  return { t, phase, phaseIndex, local };
}
