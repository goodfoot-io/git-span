import { afterEach, describe, expect, it, vi } from 'vitest';
import { assemblePlugin } from '../../src/opencode/index.js';
import { createNoteReviewHandler } from '../../src/opencode/review-notes.js';
import type { OpencodeReviewClient } from '../../src/opencode/types.js';
import { present } from '../helpers.js';
import { makeTempLayout } from '../session-layout-helpers.js';

const layouts: ReturnType<typeof makeTempLayout>[] = [];
afterEach(() => {
  for (const layout of layouts.splice(0)) layout.cleanup();
});

function fixture() {
  const temp = makeTempLayout();
  layouts.push(temp);
  const get = vi.fn<OpencodeReviewClient['session']['get']>(async () => ({ id: 's' }));
  const synthetic = vi.fn<OpencodeReviewClient['session']['synthetic']>(async () => ({ data: undefined }));
  const warn = vi.fn();
  const deps = {
    check: vi.fn<import('../../src/common/review-notes-stop.js').NoteReviewCheck>(async () => ({
      kind: 'matching',
      repositories: []
    })),
    directory: temp.parent,
    layout: temp.layout,
    client: { session: { get, synthetic } },
    logger: { warn }
  };
  return { ...deps, get, synthetic, warn };
}

describe('OpenCode idle note review', () => {
  it('resumes a root session once with a synthetic review prompt, and re-arms on a user message', async () => {
    const deps = fixture();
    const hooks = assemblePlugin(deps);
    const message = present(hooks['chat.message'], 'chat.message');
    const event = present(hooks.event, 'event');
    const idle = { event: { type: 'session.idle', properties: { sessionID: 's' } } };
    await message({ sessionID: 's' }, { parts: [{ type: 'text', text: 'work' }] });
    await Promise.all([event(idle), event(idle)]);
    expect(deps.synthetic).toHaveBeenCalledOnce();
    const request = deps.synthetic.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      sessionID: 's',
      text: expect.stringContaining('Load the review-notes skill'),
      resume: true
    });
    expect(deps.synthetic.mock.calls[0]?.[1]).toMatchObject({ signal: expect.any(AbortSignal) });
    await message({ sessionID: 's' }, { parts: [{ type: 'text', synthetic: true, text: 'review' }] });
    await event(idle);
    expect(deps.synthetic).toHaveBeenCalledOnce();
    await message({ sessionID: 's' }, { parts: [{ type: 'text', text: 'next task' }] });
    await event(idle);
    expect(deps.synthetic).toHaveBeenCalledTimes(2);
    expect(deps.warn).not.toHaveBeenCalled();
  });

  it('silently skips empty notes without resuming the session', async () => {
    const deps = fixture();
    deps.check.mockResolvedValue({ kind: 'empty' });
    const handler = createNoteReviewHandler(deps);
    handler.message('s', [{ type: 'text' }]);
    await Promise.all([handler.idle('s'), handler.idle('s')]);
    expect(deps.check).toHaveBeenCalledOnce();
    expect(deps.synthetic).not.toHaveBeenCalled();
    expect(deps.warn).not.toHaveBeenCalled();
  });

  it('surfaces lookup failure once and never turns it into a review request', async () => {
    const deps = fixture();
    deps.check.mockResolvedValue({ kind: 'failure', reason: 'native lookup timeout' });
    const handler = createNoteReviewHandler(deps);
    handler.message('s', [{ type: 'text' }]);
    await handler.idle('s');
    await handler.idle('s');
    expect(deps.synthetic).toHaveBeenCalledOnce();
    expect(deps.synthetic.mock.calls[0]?.[0].text).toContain('could not read commit notes');
    expect(deps.synthetic.mock.calls[0]?.[0].text).toContain('native lookup timeout');
    expect(deps.synthetic.mock.calls[0]?.[0].text).not.toContain('Dispatch a forked');
  });

  it('does not recursively review child sessions', async () => {
    const deps = fixture();
    deps.get.mockResolvedValue({ id: 's', parentID: 'parent' });
    const handler = createNoteReviewHandler(deps);
    handler.message('s', [{ type: 'text', text: 'review' }]);
    await handler.idle('s');
    expect(deps.synthetic).not.toHaveBeenCalled();
  });

  it('does not review unobserved sessions or empty/synthetic-only messages', async () => {
    const deps = fixture();
    const handler = createNoteReviewHandler(deps);
    for (const parts of [undefined, [], [{ type: 'text', synthetic: true }]]) {
      handler.message('s', parts);
      await handler.idle('s');
    }
    expect(deps.get).not.toHaveBeenCalled();
  });

  it('does not auto-retry a failed continuation', async () => {
    const deps = fixture();
    deps.synthetic.mockRejectedValue(new Error('unavailable'));
    const handler = createNoteReviewHandler(deps);
    handler.message('s', [{ type: 'text' }]);
    await handler.idle('s');
    await handler.idle('s');
    expect(deps.synthetic).toHaveBeenCalledOnce();
    expect(deps.warn).toHaveBeenCalledOnce();
  });

  it('forgets pending review when the host deletes a session', async () => {
    const deps = fixture();
    const hooks = assemblePlugin(deps);
    await present(hooks['chat.message'], 'chat.message')({ sessionID: 's' }, { parts: [{ type: 'text' }] });
    const event = present(hooks.event, 'event');
    await event({ event: { type: 'session.deleted', properties: { info: { id: 's' } } } });
    await event({ event: { type: 'session.idle', properties: { sessionID: 's' } } });
    expect(deps.synthetic).not.toHaveBeenCalled();
  });

  it('does not resume a failed session', async () => {
    const deps = fixture();
    const hooks = assemblePlugin(deps);
    await present(hooks['chat.message'], 'chat.message')({ sessionID: 's' }, { parts: [{ type: 'text' }] });
    const event = present(hooks.event, 'event');
    await event({ event: { type: 'session.error', properties: { sessionID: 's' } } });
    await event({ event: { type: 'session.idle', properties: { sessionID: 's' } } });
    expect(deps.synthetic).not.toHaveBeenCalled();
  });

  it.each(['forget', 'clear', 'message'] as const)('cancels a stale in-flight lookup on %s', async (change) => {
    const deps = fixture();
    let complete: (value: { id: string }) => void = () => {};
    deps.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    const handler = createNoteReviewHandler(deps);
    handler.message('s', [{ type: 'text' }]);
    const idle = handler.idle('s');
    if (change === 'message') handler.message('s', [{ type: 'text' }]);
    else if (change === 'clear') handler.clear();
    else handler.forget('s');
    complete({ id: 's' });
    await idle;
    expect(deps.synthetic).not.toHaveBeenCalled();
  });
});
