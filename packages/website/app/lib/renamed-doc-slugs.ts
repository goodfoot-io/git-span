/**
 * Docs pages whose published URL changed, mapped old slug -> new slug.
 *
 * The repo's no-backwards-compatibility policy governs the CLI surface; a
 * published docs URL is different, because third parties link to it and we
 * don't control those links. A renamed page therefore keeps a permanent
 * redirect rather than starting to 404.
 */
export const RENAMED_DOC_SLUGS: Record<string, string> = {
  // `git span stale` became `git span drift`; the guide's slug followed.
  'guides/reconcile-stale-spans': 'guides/reconcile-drifted-spans'
};
