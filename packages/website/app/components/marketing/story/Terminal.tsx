import type { PhaseId } from './scene';
import type { DiffRow, TermLine } from './transcript';
import { STATE_TIMELINES, STATE_TITLE } from './transcript';

const BULLET = '●';
const BRANCH = '⎿';
// Claude Code cycles randomized gerunds on its status line while it works.
const GERUNDS = ['Herding', 'Musing', 'Percolating', 'Noodling', 'Simmering', 'Conjuring', 'Wrangling', 'Puzzling'];

// Present agent actions the way Claude Code labels its tool calls.
function toolLabel(line: TermLine): { name: string; args: string } {
  const text = line.text ?? '';
  if (line.kind === 'command') return { name: 'Bash', args: text.replace(/^\$\s*/, '') };
  if (line.kind === 'read') return { name: 'Read', args: text.replace(/^Read\s+/, '') };
  if (line.kind === 'action') {
    if (text.startsWith('Editing ')) return { name: 'Update', args: text.slice('Editing '.length) };
    if (text.startsWith('Saved ')) return { name: 'Write', args: text.slice('Saved '.length) };
  }
  return { name: text, args: '' };
}

function Caret() {
  return <span className="ml-0.5 inline-block h-3.5 w-[0.45rem] translate-y-[0.15rem] bg-terminal-ink/80" />;
}

function DiffBlock({ rows, startLine, file }: { rows: DiffRow[]; startLine: number; file?: string }) {
  const adds = rows.filter((r) => r.sign === '+').length;
  const removes = rows.filter((r) => r.sign === '-').length;
  let counter = startLine;
  const numbered = rows.map((row) => {
    const current = counter;
    if (row.sign !== '-') counter += 1;
    return { row, num: current };
  });

  return (
    <div className="text-terminal-ink-faint">
      {file && (
        <div className="flex gap-1.5">
          <span className="shrink-0 select-none">{BRANCH}</span>
          <span>
            Updated <span className="text-terminal-ink">{file}</span> with {adds} addition{adds === 1 ? '' : 's'} and{' '}
            {removes} removal{removes === 1 ? '' : 's'}
          </span>
        </div>
      )}
      <div className="mt-0.5 ml-3">
        {numbered.map(({ row, num }) => {
          const band =
            row.sign === '+'
              ? 'bg-[rgba(80,190,110,0.15)] text-[#a3dcb0]'
              : row.sign === '-'
                ? 'bg-[rgba(224,90,100,0.15)] text-[#e2a6ab]'
                : 'text-terminal-ink-faint';
          return (
            <div key={`${row.sign}|${row.text}`} className="flex whitespace-pre">
              <span className="w-8 shrink-0 select-none pr-2 text-right text-[0.7rem] text-terminal-ink-faint/45">
                {num}
              </span>
              <span className={`flex-1 ${band}`}>
                <span className="select-none">{row.sign === ' ' ? '  ' : `${row.sign} `}</span>
                {row.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// One transcript line. `text` is the (possibly partially-typed) content; `typing` shows a caret.
function Line({ line, text, typing }: { line: TermLine; text: string; typing: boolean }) {
  if (line.kind === 'blank') {
    return <div className="h-2.5" />;
  }

  if (line.kind === 'user') {
    return (
      <div className="my-0.5 flex items-baseline gap-2">
        <span className="shrink-0 select-none text-terminal-ink-faint">&gt;</span>
        <span className="bg-terminal-raised px-1 text-terminal-ink">{text.replace(/^>\s*/, '')}</span>
      </div>
    );
  }

  if (line.kind === 'diff' && line.diff) {
    return <DiffBlock rows={line.diff} startLine={line.startLine ?? 1} file={line.file} />;
  }

  if (line.kind === 'trace' && line.lines) {
    return (
      <div className="flex gap-2">
        <span className="shrink-0 select-none text-terminal-ink-faint">{BRANCH}</span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap text-terminal-danger">{line.lines.join('\n')}</span>
      </div>
    );
  }

  if (line.kind === 'span' && line.lines) {
    // The span is a recorded artifact surfacing — an injected context block, not agent chatter.
    return (
      <div className="my-1.5 rounded border border-terminal-span/40 bg-terminal-span/10 px-3 py-2">
        <div className="mb-1 flex items-center gap-1.5 text-[0.65rem] uppercase tracking-wide text-terminal-span/80">
          <span>◆</span> git-span · recorded relationship
        </div>
        <div className="whitespace-pre-wrap text-terminal-span/90">{line.lines.join('\n')}</div>
      </div>
    );
  }

  if (line.kind === 'output' || line.kind === 'success') {
    const tone = line.kind === 'success' ? 'text-terminal-success' : 'text-terminal-ink-faint';
    return (
      <div className="flex gap-2">
        <span className="shrink-0 select-none text-terminal-ink-faint">{BRANCH}</span>
        <span className={`min-w-0 flex-1 whitespace-pre-wrap ${tone}`}>{text}</span>
      </div>
    );
  }

  if (line.kind === 'note') {
    // The agent's own message: white bullet, typed in.
    return (
      <div className="flex gap-2">
        <span className="shrink-0 select-none text-terminal-ink">{BULLET}</span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap text-terminal-ink">
          {text}
          {typing && <Caret />}
        </span>
      </div>
    );
  }

  // command / read / action — a tool call: green bullet, bold tool name, args.
  const { name, args } = toolLabel(line);
  return (
    <div className="flex gap-2">
      <span className="shrink-0 select-none text-cc-tool">{BULLET}</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap text-terminal-ink">
        <span className="font-semibold">{name}</span>
        {args && `(${args})`}
      </span>
    </div>
  );
}

// Terminal styled after the Claude Code environment. `progress` (0..1) scrubs the state's
// playback timeline; `playing` shows the live "Working…" line. Uniform 4:3 size.
export function Terminal({ state, progress, playing }: { state: PhaseId; progress: number; playing: boolean }) {
  const timeline = STATE_TIMELINES[state];
  const total = timeline?.total ?? 1;
  const elapsed = total * Math.min(1, Math.max(0, progress));
  const rows = (timeline?.entries ?? []).map((entry, position) => ({ id: `${state}-${position}`, entry }));

  // The user's request is typed into the input box, then "sent" — it appears in the transcript
  // once its typing window ends.
  const typingUser = (timeline?.entries ?? []).find(
    (entry) => entry.line.kind === 'user' && elapsed >= entry.start && elapsed < entry.end
  );
  let inputContent = '';
  if (typingUser) {
    const content = (typingUser.line.text ?? '').replace(/^>\s*/, '');
    const fraction = (elapsed - typingUser.start) / Math.max(0.001, typingUser.end - typingUser.start);
    inputContent = content.slice(0, Math.max(0, Math.floor(fraction * content.length)));
  }

  return (
    <div className="flex aspect-[4/3] w-full flex-col overflow-hidden rounded-lg border border-terminal-rule bg-terminal">
      {/* macOS title bar */}
      <div className="relative flex items-center border-b border-terminal-rule bg-terminal-raised px-3 py-2">
        <div className="flex gap-2">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <span className="absolute left-1/2 max-w-[70%] -translate-x-1/2 truncate px-2 font-mono text-xs font-semibold text-terminal-ink-faint">
          ✳ {STATE_TITLE[state] ?? 'claude'}
        </span>
      </div>

      {/* Transcript, bottom-anchored. */}
      <div className="flex flex-1 flex-col justify-end gap-0.5 overflow-hidden px-4 py-3 font-mono text-xs leading-relaxed">
        {rows.map(({ id, entry }) => {
          if (elapsed < entry.start) return null;
          // A user message lives in the input box until it is sent, then appears here.
          if (entry.line.kind === 'user' && elapsed < entry.end) return null;
          const full = entry.line.text ?? '';
          let text = full;
          let typing = false;
          // Only the agent's own messages type in place; the user message typed in the box above.
          if (entry.line.kind === 'note' && elapsed < entry.end) {
            const fraction = (elapsed - entry.start) / Math.max(0.001, entry.end - entry.start);
            text = full.slice(0, Math.max(0, Math.floor(fraction * full.length)));
            typing = true;
          }
          return (
            <div key={id} className={entry.line.kind === 'note' ? undefined : 'term-line-in'}>
              <Line line={entry.line} text={text} typing={typing} />
            </div>
          );
        })}
        {playing && progress < 1 && !typingUser && (
          <div className="mt-1 text-cc-accent">
            ✳ {GERUNDS[Math.floor(elapsed / 2) % GERUNDS.length]}… ({Math.floor(elapsed)}s · ✳{' '}
            {Math.round(200 + elapsed * 380)} tokens · <span className="font-semibold">esc</span> to interrupt)
          </div>
        )}
      </div>

      {/* Input row — the user's request is typed here before it is sent. */}
      <div className="flex items-center border-t border-terminal-rule px-4 py-2.5 font-mono text-xs">
        <span className="mr-2 shrink-0 text-terminal-ink-faint">&gt;</span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-terminal-ink">
          {inputContent}
          <span className="term-cursor ml-px inline-block h-3.5 w-[0.5rem] align-middle bg-terminal-ink/80" />
        </span>
      </div>

      {/* Mode line */}
      <div className="flex items-center justify-between border-t border-terminal-rule px-4 py-1.5 font-mono text-[0.7rem]">
        <span className="text-terminal-ink-faint/70">? for shortcuts</span>
        <span className="text-cc-violet">⏵⏵ auto-accept edits on (shift+tab to cycle)</span>
      </div>
    </div>
  );
}
