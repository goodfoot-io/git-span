/** Claude Stop hook — finish without automatic span review. */
import { type HookContext, type StopInput, stopHook } from '@goodfoot/agent-hooks/claude-code';
import { disableUpdateCheck } from '../common/update-check-env.js';

export function createHandler() {
  return async (_input: StopInput, _ctx: HookContext) => null;
}

disableUpdateCheck();
export default stopHook({ timeout: 10_000 }, createHandler());
