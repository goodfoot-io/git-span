import { PHASE_COPY } from './copy';
import type { SceneState } from './scene';

interface AutomotiveStubProps {
  scene: SceneState;
}

export function AutomotiveStub({ scene }: AutomotiveStubProps) {
  const percent = Math.round(scene.local * 100);
  const caption = PHASE_COPY[scene.phase.id].caption;
  const translateY = (0.5 - scene.local) * 24;
  const scale = 0.94 + scene.local * 0.06;

  const frameClass = 'flex h-full w-full flex-col overflow-hidden rounded-lg border border-dashed';
  const markerClass = 'flex h-24 w-24 items-center justify-center rounded-full border border-dashed';
  const trackClass = 'h-2 w-full overflow-hidden rounded-full border border-dashed';

  return (
    <div className={`${frameClass} border-rule bg-ground`}>
      <div className="flex items-center justify-between border-b border-dashed border-rule px-3 py-1.5">
        <span className="font-mono text-xs uppercase tracking-wide text-ink-tertiary">AUTOMOTIVE — placeholder</span>
        <span className="font-mono text-xs text-ink-tertiary">
          state {scene.phaseIndex + 1} / {scene.phase.id}
        </span>
      </div>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-6">
        <div
          className={`${markerClass} border-linkage bg-ground-raised`}
          style={{ transform: `translateY(${translateY}px) scale(${scale})` }}
        >
          <span className="font-mono text-xs text-linkage">{scene.local.toFixed(2)}</span>
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-dashed border-rule px-3 py-2">
        <div className={`${trackClass} border-rule bg-ground-sunken`}>
          <div className="h-full rounded-full bg-accent transition-none" style={{ width: `${percent}%` }} />
        </div>
        <p className="font-mono text-xs text-ink-secondary">{caption}</p>
      </div>
    </div>
  );
}
