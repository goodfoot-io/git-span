---
title: Homepage Engine Animation
summary: Architecture of the scroll-driven Three.js V8 engine animation on the git-span homepage — the pure-choreography/imperative-rendering split, how exploded poses are derived from a baked FBX animation that isn't an exploded view, and the rendering gotchas that bit the first implementation.
aliases: [Engine Animation, EngineScene, Homepage 3D Animation, V8 Engine Animation]
tags: [architecture, website, threejs]
keywords: [three.js, glTF, GLB, exploded view, scroll timeline, EngineScene, beats.ts, EngineFrame, git-span metaphor, meshopt]
---

The git-span homepage's pinned right-column media is a scroll-scrubbed Three.js animation of
a V8 engine, standing in as a physical metaphor for the product itself: a resized front
accessory drive (belt, crankshaft/camshaft sprockets, gear, throttle body) fails to seat on the
engine block until the recorded relationship surfaces and the block's front mounts resize to
match. It replaced an earlier automotive-suspension placeholder. The full narrative spec lives
in [`reports/engine-plan.md`](../../reports/engine-plan.md) (the amended, as-built plan) and
[`reports/unified-homepage.md`](../../reports/unified-homepage.md) (the page's overall prose
and layout narrative, still suspension-themed in places — the animation section is superseded
by the engine plan).

## Where the code lives

All of it is under `packages/website/app/components/marketing/story/`:

- [`scene.ts`](../../packages/website/app/components/marketing/story/scene.ts#L24-L33) — the
  shared scroll timeline: `PHASE_WEIGHTS` (the 8 phases and their relative scroll heights),
  `deriveScene()`, and the easing/ramp helpers every other module reuses. Not engine-specific —
  also drives the left-column prose and terminal specimens.
- [`copy.ts`](../../packages/website/app/components/marketing/story/copy.ts#L68-L129) —
  `PHASE_COPY`: per-phase prose headline/body and the animation caption shown in the loading
  fallback and read by screen readers.
- [`EngineStage.tsx`](../../packages/website/app/components/marketing/story/EngineStage.tsx#L1-L99)
  — the React mount point. Client-only boot, loading/fallback UI, `aria-live` caption,
  `ResizeObserver`, reduced-motion detection.
- `engine/beats.ts` — pure `SceneState -> EngineFrame` choreography. No `three` import.
- `engine/parts.ts` — pure mesh-name → material-family lookup and the front-drive/mount part
  lists. No `three` import.
- `engine/EngineScene.ts` — the **only** file that imports `three`. Loads the GLB, bakes poses,
  and does all per-frame imperative rendering.
- `packages/website/app/assets/engine/` — the committed GLB (`engine.glb`, ~1 MB, meshopt-
  compressed) and three WebP detail maps (`engine-normal`, `engine-roughness`, `engine-ao`).
  No albedo/color texture ships — see [Materials](#materials-why-there-is-no-albedo-texture).

Mounted in [`_index.tsx`](../../packages/website/app/routes/_index.tsx#L128-L134) inside the
pinned right column, and enabled for `.glb` imports by one line in
[`vite.config.ts`](../../packages/website/vite.config.ts#L21-L25).

## Data flow

```
scroll
  -> useTimeline (scene.ts)          -- measures the first story step's viewport position
  -> deriveScene(t)                  -- SceneState { t, phase, phaseIndex, local }
       |
       +-> PHASE_COPY[phase.id]      -- prose + caption (copy.ts, pure)
       |
       +-> engineFrame(scene)        -- EngineFrame (beats.ts, pure)
             -> EngineScene.setFrame(frame)   -- imperative three.js (EngineScene.ts)
```

`EngineFrame` (defined in
[`beats.ts#L37-L51`](../../packages/website/app/components/marketing/story/engine/beats.ts#L37-L51))
is the **entire contract** between the pure and imperative halves — one flat object of numbers,
computed fresh from `(phase, local)` with no memory of the previous call. That's what makes
scrubbing backwards through the timeline exactly as valid as scrubbing forwards: there is no
animation *state* to un-advance, only a pure function to re-evaluate. Any new behavior should
be added as a new `EngineFrame` field computed the same way — resist the temptation to give
`EngineScene` its own timeline-dependent state.

`EngineStage.tsx` wires this together: a `useEffect` boots `EngineScene` via dynamic
`import('./engine/EngineScene')` (three.js never loads during SSR or blocks the initial
bundle), and a second effect calls `engine.setFrame(engineFrame(scene))` on every `scene`
change once loaded. A load or WebGL failure sets `status: 'fallback'`, which renders the quiet
`#f2efe6` frame with the phase caption instead of a canvas.

## The eight phases

`PhaseId` (from `scene.ts`) is `'hero' | 'traverse' | 'change' | 'failure' | 'second' | 'span' |
'related' | 'success'`. Each has a dedicated `*At(phase, local)` function in
[`beats.ts#L53-L222`](../../packages/website/app/components/marketing/story/engine/beats.ts#L53-L222),
one per `EngineFrame` field, assembled by
[`engineFrame()`](../../packages/website/app/components/marketing/story/engine/beats.ts#L224-L244).

| Phase | What happens physically |
|---|---|
| `hero` | Assembled engine, slow idle rotation (the only time-based motion; see below) |
| `traverse` | Camera pulls back; all parts separate in unison into the exploded view |
| `change` | Front-drive parts (belt, sprockets, gear, throttle body) grow to `FRONT_SCALE`, green highlight pulses in-hold-out |
| `failure` | Camera pushes in; reassembly stalls at `FAIL_STOP` — a visible gap where the oversized front drive can't seat; the block's front mount (`engineBlockFront`) flags red |
| `second` | Re-explode from the stalled gap back to the full exploded view; red fades |
| `span` | Amber linkage lines draw from each front-drive part to the mount; the mount begins glowing green |
| `related` | Mount resizes to `MOUNT_SCALE`; amber and the "just resizing" green fade as geometry resolves |
| `success` | Camera pushes in; front-drive targets remap onto the resized mount (`seatAdjust`) and everything seats cleanly |

Each `*At` function is a plain `switch` over `PhaseId` with no `default` fallthrough between
cases that should hold a value — **a value not respecified for a later phase holds at its
previous phase's end value** (e.g. `frontDriveScaleAt` returns `FRONT_SCALE` for every phase
from `change` onward, including `success` — the resize is permanent, not undone by the story).
When adding a new phase or field, decide explicitly whether it should hold, reset, or animate,
and write every case — a missing `case` is a TypeScript exhaustiveness error by design (no
`default` on the phase-keyed switches).

## Pose model: how "exploded" is derived (read this before touching poses)

This is the least obvious part of the system and the one most likely to break silently if
touched without context.

The source model ships one baked animation clip in the GLB (assimp's `"Take 001"`, ~984
channels). It is **not** an authored exploded-view constellation — verification during the
build found it to be a **sequential one-part-at-a-time fly-in**: at frame 0, parts are parked
in arbitrary off-stage staging positions (not a clean "pulled back along its axis" pose), and
they fly in to their assembled seat one after another as the clip plays. Naively sampling
frame 0 as "exploded" and the last frame as "assembled" renders a scattered speck cloud, not an
engine.

[`EngineScene.load()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L118-L282)
handles this in two steps:

1. **Bake assembled poses from the last frame.** The `AnimationMixer` must be set to
   `THREE.LoopOnce` with `clampWhenFinished = true`
   ([`EngineScene.ts#L146-L152`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L146-L152))
   before calling `mixer.setTime(clip.duration)`. With the default `LoopRepeat`, `setTime`
   wraps the duration back to frame 0, so both the "staging" and "assembled" samples silently
   capture the same pose. This exact bug shipped in the first draft.
2. **Synthesize exploded poses from the authored assembly axis, not raw staging distance**
   ([`EngineScene.ts#L184-L210`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L184-L210)).
   What the staging frame *does* reliably carry is each part's direction of travel
   (staging → assembled, reversed = the assembly axis). The exploded position is the assembled
   position pushed along that axis, with the raw staging distance compressed by
   `rawDistance / (rawDistance + modelRadius)` into `[EXPLODE_MIN_FRACTION,
   EXPLODE_MAX_FRACTION]` (0.18–0.75) of the model's bounding radius — so a part staged
   arbitrarily far away still explodes to a bounded, camera-friendly distance. Orientation and
   scale are held at their assembled values; a technical exploded view translates parts, it
   doesn't tumble them.

A part whose track never actually moves it (assembled ≈ staging) falls back to exploding
radially away from the model centroid instead of a zero-length axis.

After baking, the imported `gltf.scene` (and its `$AssimpFbx$` pivot chains, an assimp FBX
import artifact) is discarded. Every part becomes a fresh flat-hierarchy `THREE.Mesh` sharing
the original geometry, parented directly under one `THREE.Group` — there is no scene graph
depth to reason about at render time, just a flat `PartRecord[]`
([`EngineScene.ts#L23-L31`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L23-L31)).

## Materials: why there is no albedo texture

The source FBX's baked albedo photo-texture paints the cylinder-head covers bright red with a
visible "V8" logo — both unacceptable, since red is reserved for the failure/mismatch
highlight and a baked logo shouldn't ship. The runtime assigns materials by **part family**
instead: [`parts.ts`](../../packages/website/app/components/marketing/story/engine/parts.ts#L1-L69)
maps every mesh name to one of seven families (`structure`, `frontCover`, `rotating`,
`aluminum`, `polymer`, `rubber`, `hardware`) via longest-prefix, case-insensitive matching, and
`FAMILY_MATERIAL` gives each a flat color/roughness/metalness. All families still share the
GLB's normal, roughness, and AO detail maps (loaded and configured in
[`EngineScene.ts#L120-L136`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L120-L136))
for surface realism — only the color layer is synthetic.

The source naming has real inconsistencies that `familyOf` must tolerate:
`cylinderHeadCoverleft` (lowercase `l`) vs `cylinderHeadCoverRight`, and
`intakeManifoldleft` vs `intakeManifoldRight`. Matching is case-insensitive and prefix-based
specifically to survive this. If a future GLB re-export changes a mesh name,
`familyOf`'s fallback (`hardware` for anything containing "bolt"/"nut", `structure`
otherwise) prevents a silent crash but will look wrong — check the mesh-name list in
[`parts.ts`](../../packages/website/app/components/marketing/story/engine/parts.ts) against
the new export.

`FRONT_DRIVE` and `FRONT_MOUNT`
([`parts.ts#L71-L83`](../../packages/website/app/components/marketing/story/engine/parts.ts#L71-L83))
are the two lists that drive the whole failure/success narrative — the exact mesh names that
resize (`belt`, `crankshaftSprocket`, `camshaftSprocket`, `gear`, `throttleBody`) and the mesh
that receives the highlight and resize on the other side (`engineBlockFront`). Changing which
physical parts tell the story is a one-line edit here, not in `EngineScene.ts` or `beats.ts`.

## Highlights and linkage: why they're "x-ray"

Highlight shells are geometry clones scaled to 1.02× sitting just outside their part, built in
[`buildHighlightShells()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L386-L426).
Front-drive green shells are ordinary depth-tested overlays — their parts are visible whenever
they're highlighted. The **mount's** red/green shells and the **amber linkage** cylinders
(built in
[`buildLinkageLines()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L430-L449))
instead use `depthTest: false` with a high `renderOrder` — an "x-ray" material — because
`engineBlockFront` sits buried inside the assembled engine at exactly the beats
(`failure`/`span`/`related`) where it needs to flag red or green, and a depth-tested overlay on
a fully occluded mesh would simply never be seen.

The linkage itself is drawn as thin unlit cylinder meshes (`CylinderGeometry`, radius ≈
`modelRadius * 0.008`), not `THREE.Line` — `LineBasicMaterial` renders at a fixed one
device-pixel width regardless of scene scale, which is invisible against the pale page
background at the size this animation renders. If a future addition needs another kind of
line-like overlay, reuse the cylinder-mesh approach, not `THREE.Line`.

## Camera framing: the never-cropped constraint

The page's framing rule is that the engine must never touch the media frame's edges, at any
beat, including fully exploded (when the model's footprint is largest). This is solved
mathematically rather than by hand-tuning per-beat camera shots:
[`fitCameraToFrame()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L491-L517)
computes the union bounding sphere of every part's current world position each frame
(`sphereUnion`, a standard two-sphere merge,
[`EngineScene.ts#L56-L72`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L56-L72)),
then places the camera at the distance that fits that sphere plus a margin, accounting for
aspect ratio via `fitFov = min(fovY/2, atan(tan(fovY/2) * aspect))`. `frame.margin`
(`MARGIN_ASSEMBLED` = 1.12, `MARGIN_FAILURE` = 1.06 — tighter once the camera pushes in) is
the one per-beat tuning knob; everything else in the shot is derived, not staged. If a future
part addition makes the model's silhouette asymmetric in a way the bounding sphere
under-serves, adjust the margin constants before reaching for a bespoke camera path.

`azimuth`/`elevation` hold at `CANONICAL_AZIMUTH`/`CANONICAL_ELEVATION` (35°/18°) from
`traverse` onward, plus a slow `AZIMUTH_DRIFT` (+18° over the whole timeline) that keeps
parallax alive while scrubbing without breaking reversibility — it's a pure function of `t`.

The hero's idle rotation is the **one** deliberate time-based (non-scroll) motion in the whole
system: a `requestAnimationFrame` loop in `EngineScene` (`idleTick`,
[`EngineScene.ts#L332-L343`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L332-L343))
accumulates `idleAzimuthOffset` at `HERO_IDLE_RATE` (one turn per 45s) while
`setHeroIdle(true)`. `EngineFrame.idleWeight` (1 in `hero`, eased to 0 over the first third of
`traverse`) blends that accumulated offset into the camera azimuth
([`EngineScene.ts#L506`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L506))
so the first scroll movement smoothly absorbs whatever rotation had accumulated instead of
snapping the camera back to the base azimuth. `EngineStage.tsx` calls `setHeroIdle` based on
`scene.phase.id === 'hero' && !matchMedia('(prefers-reduced-motion: reduce)').matches` — this
is the only motion disabled under reduced motion; everything else is already scroll-bound.

## Asset pipeline (manual, not a repo script)

The committed GLB is **not regenerated by any build step** — it was produced once from
`reports/v8-engine.zip` (an FBX + PBR texture set, not committed) via a manual pipeline
recorded in [`reports/engine-plan.md`](../../reports/engine-plan.md):
`assimp export ... -fglb2` → strip the embedded texture/material → `gltf-transform prune
--keep-attributes true` (the default `prune` silently deletes UVs — must pass this flag) →
`dedup` → `meshopt` compression. Detail maps were separately resized to 1024px and re-encoded
as WebP. If the source model ever changes, redo this by hand following that document — there
is no `yarn` script wired up for it, deliberately, since it only needs to run when the art
asset itself changes, not on every build.

## How to verify a change visually

**Cloud/remote browser sessions in this environment have no WebGL support at all** — a
Browser Use cloud daemon will always render the fallback frame, which looks like success but
proves nothing about the animation. Visual verification requires a local headless Chromium
with a software GL backend:

```bash
chromium --headless --no-sandbox \
  --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
```

driven by `puppeteer-core` (`executablePath: '/usr/bin/chromium'`), scrolling the dev server
(`yarn dev` in `packages/website`, served at `localhost:5173` and tunneled to
`local.git-span.com`) to computed positions. The scroll-to-timeline math mirrors
`timelineFromScroll` in `scene.ts`: for a target `t` (0–100), first find the first story step's
absolute top (`baseTop`), then `scrollY = baseTop - viewportHeight + (t/100) *
TIMELINE_SCROLL_VH * viewportHeight`, where `TIMELINE_SCROLL_VH` is the exported constant from
`scene.ts`. Wait for a `canvas` element (confirms `status === 'ready'`, not the fallback)
before screenshotting. This harness was written ad hoc during development and was not
committed to the repo — recreate it from this description if needed, or check
`reports/engine-plan.md`'s validation section for the beat-by-beat `t` values used during the
last review pass.

To sanity-check reduced motion specifically: screenshot the hero twice, a few seconds apart,
once with `page.emulateMediaFeatures([{name: 'prefers-reduced-motion', value: 'reduce'}])` and
once without — the frames should be byte-identical under the emulation and different without
it.

## Tuning constants reference

All in [`beats.ts#L8-L35`](../../packages/website/app/components/marketing/story/engine/beats.ts#L8-L35):

| Constant | Value | Controls |
|---|---|---|
| `FRONT_SCALE` | 1.15 | Front-drive parts' scale at the top of `change`, held through `success` |
| `MOUNT_SCALE` | 1.15 | `engineBlockFront`'s scale at the top of `related`, held through `success` |
| `FAIL_STOP` | 0.5 | Residual front-drive explode fraction in `failure` — the gap that won't close. (Shipped first at 0.22; visual review found the gap illegible that tight, since front-drive parts sit deep in the assembly — raised to 0.5.) |
| `MARGIN_ASSEMBLED` | 1.12 | Camera fit margin for `hero`/`traverse`/`change` |
| `MARGIN_FAILURE` | 1.06 | Tighter margin from `failure` onward (the auto push-in) |
| `AZIMUTH_DRIFT` | 18° | Total camera azimuth drift across the whole timeline (parallax while scrubbing) |
| `HERO_IDLE_RATE` | 2π/45 | Hero idle rotation: one full turn per 45s |

Highlight opacity multipliers (0.45 green, 0.55 red) and the linkage draw stagger are inline in
[`updateHighlights()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L451-L459)
and
[`updateLinkage()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L461-L489)
rather than named constants — promote them if they need frequent tuning.

## Related pages

- [`reports/engine-plan.md`](../../reports/engine-plan.md) — the full design plan this
  implementation follows, including the approved amendments (flat materials, sampled exploded
  poses, gap-first failure, amber linkage, transparent canvas, bounding-sphere camera) and their
  rationale.
- [`reports/unified-homepage.md`](../../reports/unified-homepage.md) — the homepage's overall
  narrative, layout, and copy specification (predates the engine swap; its automotive-specific
  sections describe the superseded suspension metaphor, but the page architecture, prose
  stages, and terminal specification still apply).
