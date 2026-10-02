/** Shared bounds for serialized receipt state and its readers. */
export const COMMIT_RECEIPT_LIMITS = {
  jsonFileBytes: 1_048_576,
  identityKeyBytes: 256,
  reflogBytes: 1_048_576,
  receiptsPerInvocation: 256,
  bytesPerInvocation: 4_194_304,
  invocations: 4096,
  totalBytes: 67_108_864,
  abandonedRetentionMs: 86_400_000,
  drainMs: 3000,
  cliMs: 2000
} as const;
