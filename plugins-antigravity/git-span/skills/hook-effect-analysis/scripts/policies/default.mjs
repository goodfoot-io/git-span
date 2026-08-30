// Generated from skills-src/git-span/hook-effect-analysis/scripts/policies/default.mjs by scripts/build-agent-skills.mjs — do not edit; change the template and rebuild.
// Built-in example policies for simulate.mjs — a runnable smoke test, not a
// recommendation. Each is a named export `(section, anchor) => boolean`
// where `section = {name, text, anchors}` and `anchor = {entity, line,
// touched, written, seenBefore}`. Mirrors the policy shapes tried in the
// original analysis (see plans/initial.md's prototype-simulate.py mapping).

const isTestOrAsset = (a) =>
  /\/tests?\//.test(a.entity) || /test/i.test(a.entity.split("/").pop()) ||
  /\.(png|jpg|jpeg|svg|ico|webp)$/i.test(a.entity);

export function baselineNoFilter() {
  return true;
}

export function dropBigSpan(section) {
  return section.anchors.length < 6;
}

export function capFiveAnchors(section, anchor) {
  return section.anchors.indexOf(anchor) < 5;
}

export function dropTestAndAssetAnchors(section, anchor) {
  return !isTestOrAsset(anchor);
}

export function dropBigSpanAndTestAsset(section, anchor) {
  return dropBigSpan(section) && dropTestAndAssetAnchors(section, anchor);
}

export function capFiveAndTestAsset(section, anchor) {
  return capFiveAnchors(section, anchor) && dropTestAndAssetAnchors(section, anchor);
}

export function dropBigSpanUnlessSeenBefore(section, anchor) {
  return section.anchors.length < 6 || section.anchors.some((a) => a.seenBefore);
}

export function dropBigSpanUnlessSeenBeforeAndTestAsset(section, anchor) {
  return dropBigSpanUnlessSeenBefore(section, anchor) && dropTestAndAssetAnchors(section, anchor);
}
