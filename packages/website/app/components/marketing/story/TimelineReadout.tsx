import { useEffect, useState } from 'react';
import { deriveScene } from './scene';

interface TimelineReadoutProps {
  t: number;
}

export function TimelineReadout(props: TimelineReadoutProps) {
  const [isDevHost, setIsDevHost] = useState(false);

  useEffect(() => {
    const h = window.location.hostname;
    setIsDevHost(h === 'local.git-span.com' || h === 'localhost' || h === '127.0.0.1');
  }, []);

  if (!isDevHost) return null;

  const scene = deriveScene(props.t);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed bottom-3 left-3 z-50 rounded-radius bg-terminal/90 px-3 py-1.5 font-mono text-xs shadow-lg ring-1 ring-rule/40 ring-inset"
    >
      <span className="text-terminal-ink">t {props.t.toFixed(1)}</span>
      <span className="text-terminal-ink-faint"> · </span>
      <span className="text-accent">{scene.phase.id}</span>{' '}
      <span className="text-terminal-ink-faint">{scene.local.toFixed(2)}</span>
    </div>
  );
}
