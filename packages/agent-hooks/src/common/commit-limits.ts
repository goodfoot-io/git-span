/**
 * Bounds for serialized receipt state and its readers. Input-validation sizes and deadlines are hard limits;
 * the receipt and invocation counts are windows that discard the oldest entries instead of refusing new ones.
 */
export const COMMIT_RECEIPT_LIMITS = {
  jsonFileBytes: 1_048_576,
  identityKeyBytes: 256,
  reflogBytes: 1_048_576,
  /** Newest receipts kept per invocation. */
  receiptsPerInvocation: 256,
  /** Invocation directories kept before a batch eviction starts. */
  invocationWindow: 512,
  /** Invocation count a batch eviction reduces the store to. */
  invocationWindowFloor: 384,
  /** Hard scan bound for readers that walk the invocation directory. */
  invocations: 4096,
  abandonedRetentionMs: 86_400_000,
  drainMs: 3000,
  cliMs: 2000
} as const;
