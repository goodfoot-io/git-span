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
  { id: 'traverse', label: 'Hidden connections', scrollVh: 1 },
  { id: 'change', label: 'Missing context', scrollVh: 1.5 },
  { id: 'failure', label: 'Project failure', scrollVh: 1.5 },
  { id: 'second', label: 'Reveal connections', scrollVh: 1 },
  { id: 'span', label: 'JIT documentation', scrollVh: 1 },
  { id: 'related', label: 'Better outcomes', scrollVh: 1.5 },
  { id: 'success', label: 'Everything fits', scrollVh: 0.5 }
];

// Phase geometry is center-line based: a phase is active exactly while its block straddles the
// viewport's vertical center line. Using s = viewports scrolled past "first step at viewport
// bottom" (which is what timelineFromScroll measures), the hero fills the first viewport, so it
// contains the center line for s ∈ [0, heroWeight/2]. Step i, of height h_i and preceded by steps
// summing to H_i viewports, contains the center line for s ∈ [heroWeight/2 + H_i, heroWeight/2 +
// H_i + h_i]. The timeline ends when the LAST step's content is centered -- half a step early --
// so the total scroll distance is heroWeight/2 + Σ(non-hero weights) - lastWeight/2. That is also
// the exact moment the trailing spacer in _index.tsx lets the sticky media unpin, so the story
// resolves precisely at release.
const [heroPhase, ...stepPhases] = PHASE_WEIGHTS;
const lastStepPhase = stepPhases.at(-1);
if (!heroPhase || !lastStepPhase) throw new Error('PHASE_WEIGHTS needs a hero phase and at least one step');
const heroWeight = heroPhase.scrollVh;
const lastStepWeight = lastStepPhase.scrollVh;
const stepWeightSum = stepPhases.reduce((sum, phase) => sum + phase.scrollVh, 0);

const TIMELINE_SCROLL_VH: number = heroWeight / 2 + stepWeightSum - lastStepWeight / 2;

export const TIMELINE: readonly Phase[] = (() => {
  const toPhase = ({ id, label, scrollVh }: PhaseWeight, startVh: number, endVh: number): Phase => ({
    id,
    label,
    scrollVh,
    start: (startVh / TIMELINE_SCROLL_VH) * 100,
    end: (endVh / TIMELINE_SCROLL_VH) * 100
  });
  const phases: Phase[] = [toPhase(heroPhase, 0, heroWeight / 2)];
  let cursor = heroWeight / 2;
  stepPhases.forEach((phase, index) => {
    const isLastStep = index === stepPhases.length - 1;
    const endVh = isLastStep ? cursor + phase.scrollVh - lastStepWeight / 2 : cursor + phase.scrollVh;
    phases.push(toPhase(phase, cursor, endVh));
    cursor += phase.scrollVh;
  });
  return phases;
})();

/** The timeline phase with `id`; throws if the timeline lost it, since every PhaseId has a phase. */
export function timelinePhase(id: PhaseId): Phase {
  const phase = TIMELINE.find((candidate) => candidate.id === id);
  if (!phase) throw new Error(`TIMELINE has no '${id}' phase`);
  return phase;
}

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
  return clamp01((vh - firstStepTop) / (TIMELINE_SCROLL_VH * vh)) * 100;
}

function phaseIndexAt(t: number): number {
  if (t <= 0) return 0;
  if (t >= 100) return TIMELINE.length - 1;
  const index = TIMELINE.findIndex((phase) => t >= phase.start && t < phase.end);
  return index >= 0 ? index : TIMELINE.length - 1;
}

export function deriveScene(t: number): SceneState {
  const phaseIndex = phaseIndexAt(t);
  const phase = TIMELINE[phaseIndex];
  if (!phase) throw new Error(`deriveScene: no timeline phase at index ${phaseIndex}`);
  const local = clamp01((t - phase.start) / (phase.end - phase.start));
  return { t, phase, phaseIndex, local };
}
