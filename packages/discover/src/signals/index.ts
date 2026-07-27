/**
 * Barrel for every shipped coupling signal.
 *
 * Re-exports each signal's implementation under its stable name, in the
 * same order `pipeline.ts` runs them, so the pipeline and the package
 * barrel each have a single place to import the full signal set from.
 *
 * @summary Signal-package barrel.
 */

export { clonesSignal } from './clones.js';
export { cochangeSignal } from './cochange.js';
export { commitMessagesSignal } from './commitMessages.js';
export { docReferencesSignal } from './docReferences.js';
export { implTestSignal } from './implTest.js';
export { manifestWiringSignal } from './manifestWiring.js';
export { pathLiteralsSignal } from './pathLiterals.js';
export { sharedLiteralsSignal } from './sharedLiterals.js';
export { syncCommentsSignal } from './syncComments.js';
