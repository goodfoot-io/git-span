/** Real in-memory implementation of atomic session-family claims for test stores. */
export function guidanceClaims(): (sessionId: string, family: 'list' | 'drift') => boolean {
  const claimed = new Set<string>();
  return (sessionId, family) => {
    const key = JSON.stringify([sessionId, family]);
    if (claimed.has(key)) return false;
    claimed.add(key);
    return true;
  };
}
