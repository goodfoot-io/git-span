---
title: Homepage Engine Animation
summary: Architecture of the scroll-driven, drag-orbitable Three.js V8 engine animation on the git-span homepage — the pure-choreography/imperative-rendering split, how exploded poses are derived from a baked FBX animation that isn't an exploded view, the hero's natural in-car crankshaft-axis camera framing, the shared motion driver behind idle spin and drag snap-back, the ACES-tonemapped/HDRI-lit/selective-bloom rendering pass with per-part diffuse+emissive highlight recoloring and a green-glass mismatch bounding box, atmospheric fog, the animation's return to rest at the end of the timeline, and the rendering gotchas (including a mesh-name dedup bug and a bloom-pass alpha bug) that bit past implementations.
aliases: [Engine Animation, EngineScene, Homepage 3D Animation, V8 Engine Animation, Drag to Orbit, Engine Fog]
tags: [architecture, website, threejs]
keywords: [three.js, glTF, GLB, exploded view, scroll timeline, EngineScene, beats.ts, EngineFrame, git-span metaphor, meshopt, engineBackCover, dedup suffix, drag to orbit, fog, cast iron, crankshaft-axis camera, ACES tone mapping, studio HDRI, PMREM, selective bloom, UnrealBloomPass, blackbody color, heartbeat pulse, mismatch bounding box, green glass, MeshPhysicalMaterial, RETURN_TO_NORMAL]
---

The git-span homepage's pinned right-column media is a scroll-scrubbed, pointer-draggable
Three.js animation of a V8 engine, standing in as a physical metaphor for the product itself: a
ring gear (`gear`) cycles through a multi-stage color story — orange foreshadow, blue first-stage
mismatch, red second-stage mismatch, a color-drained window where a translucent green-glass
bounding box flags the mismatch region, then a shared resolved green — in lockstep with its rear
mating plate (`engineBackCover`) and the 8 piston bodies, while briefly oversizing and
re-oversizing itself along the way. In the final stretch of the timeline (`t = 93–100`) every one
of those beats releases — green fades off, the gear and mount ease back to their natural size, the
idle turntable resumes — so the animation ends exactly as it opened: fully assembled, natural
colors and sizes, slowly turning. The ring gear is the story's sole resizing/lifting protagonist: `FRONT_DRIVE`
narrows to `['gear']` alone (belt, crankshaft/camshaft sprockets, and throttle body render as
ordinary static geometry and never resize or glow), and the gear is also the part a past silent
bug (see [the dedup-suffix trap](#trap-the-mesh-name-dedup-suffix-bug)) kept from ever resizing at
all. It replaced an earlier automotive-suspension placeholder. The full narrative spec lives in
[`reports/engine-plan.md`](../../reports/engine-plan.md) (the original, as-built design — note the
color/box timeline described there has since been substantially retimed and restructured; see [The
timeline](#the-timeline-color-scale-and-the-bounding-box) below for the current, authoritative
version) and [`reports/unified-homepage.md`](../../reports/unified-homepage.md) (the page's overall
prose and layout narrative, still suspension-themed in places — the animation section is superseded
by the engine plan).

## Where the code lives

All of it is under `packages/website/app/components/marketing/story/`:

- [`scene.ts`](../../packages/website/app/components/marketing/story/scene.ts#L24-L33) — the
  shared scroll timeline: `PHASE_WEIGHTS` (the 8 phases and their relative scroll heights),
  `deriveScene()`, and the easing/ramp helpers every other module reuses. Not engine-specific —
  also drives the left-column prose and terminal specimens.
- [`copy.ts`](../../packages/website/app/components/marketing/story/copy.ts#L77-L138) —
  `PHASE_COPY`: per-phase prose headline/body and the animation caption shown in the loading
  fallback and read by screen readers.
- [`EngineStage.tsx`](../../packages/website/app/components/marketing/story/EngineStage.tsx#L1-L100)
  — the React mount point. Client-only boot, loading/fallback UI, `aria-live` caption, and a
  `ResizeObserver`. Just two effects: one boots `EngineScene` and tears it down, the other calls
  `setFrame`/`setHeroIdle` on every `scene` change — there is no scroll-velocity listener here (an
  earlier "scroll drop impulse" effect was removed entirely; see
  [Interaction](#interaction-drag-to-orbit)).
- `engine/beats.ts` — pure `SceneState -> EngineFrame` choreography. No `three` import. Every
  documented timeline breakpoint, plus a `t = 0..100` invariant sweep, is covered by
  `engine/beats.test.ts` (46 tests).
- `engine/parts.ts` — pure mesh-name → material-family lookup, the front-drive/mount part lists,
  the dedup-suffix helper, and the explode-pose overrides. No `three` import. Covered by
  `engine/parts.test.ts` (15 tests).
- `engine/types.ts` — shared `Pose` and `PartRecord` plain-data interfaces, split out so
  `highlights.ts` and `mismatchBox.ts` can depend on them without importing `EngineScene.ts` itself.
- `engine/highlights.ts` — the highlight color system, extracted out of `EngineScene.ts`:
  `BLOOM_LAYER`, the `HighlightKind`/`HighlightStage`/`HighlightRecord` types, the
  heartbeat/emissive/blackbody tuning constants, `pulseWave()`, `blackbodyColor()`,
  `buildHighlightRecords()`, and `updateHighlights()`. Stateless — the pulse cycle/weight state
  itself still lives on `EngineScene`, which passes `pulseWeight` in each frame. Covered by
  `engine/highlights.test.ts`.
- `engine/mismatchBox.ts` — the mismatch bounding-box prop, extracted out of `EngineScene.ts`:
  `BOUNDING_BOX_MAX_OPACITY`/`BOUNDING_BOX_EDGE_OPACITY`, `computeMismatchBoxBounds()`,
  `buildBoundingBox()`, and `updateBoundingBox()`.
- `engine/EngineScene.ts` — the **only** file that imports `three`. Shrank from ~1250 to ~842 lines
  in the extraction above; it's now orchestration only: loading the GLB and studio HDRI, baking
  poses, per-frame transforms, camera/fog fitting, pointer-drag interaction, the shared motion
  driver, and the ACES/HDRI/selective-bloom rendering pipeline (see [Rendering: tone mapping, studio
  HDRI, and selective bloom](#rendering-tone-mapping-studio-hdri-and-selective-bloom)) — it delegates
  the highlight color system to `highlights.ts` and the bounding-box prop to `mismatchBox.ts`,
  calling their exported functions each frame.
- `packages/website/app/assets/engine/` — the committed GLB (`engine.glb`, ~1 MB, meshopt-
  compressed), three WebP detail maps (`engine-normal`, `engine-roughness`, `engine-ao`), and a
  studio-lighting HDRI (`studio_small_08_1k.hdr`, Poly Haven, CC0) used as the environment map. No
  albedo/color texture ships — see [Materials](#materials-why-there-is-no-albedo-texture).

Mounted in [`_index.tsx`](../../packages/website/app/routes/_index.tsx#L132-L138) inside the
pinned right column, and enabled for `.glb`/`.hdr` imports by
[`vite.config.ts`](../../packages/website/vite.config.ts#L22-L25)'s `assetsInclude`.

### Testing

A behavior-preserving pass extracted the highlight and bounding-box code out of `EngineScene.ts`
and added unit coverage that did not exist before: `beats.test.ts` exercises every documented
timeline breakpoint plus a full `t = 0..100` sweep for invariants, `parts.test.ts` covers the
mesh-name → material-family lookup and dedup-suffix handling, and `highlights.test.ts` covers
`pulseWave`/`blackbodyColor` and highlight-record building. This guards the pure choreography and
highlight math against regressions, but it does **not** replace visual verification — anything
touching rendering, camera framing, or tuning constants still needs a screenshot pass; see [How to
verify a change visually](#how-to-verify-a-change-visually) below.

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

pointer drag (canvas)  ---\
                           +-> EngineScene-internal transient state -> shared motion driver
setHeroIdle((hero || t >= RETURN_TO_NORMAL_START_T) && !reduced-motion) --/
                                                  (never touches SceneState/EngineFrame)
```

`EngineFrame` (defined in
[`beats.ts#L91-L108`](../../packages/website/app/components/marketing/story/engine/beats.ts#L100-L117))
is the **entire contract** between the pure and imperative halves — one flat object of numbers,
computed fresh from `(phase, local, t)` with no memory of the previous call. That's what makes
scrubbing backwards through the timeline exactly as valid as scrubbing forwards: there is no
animation *state* to un-advance, only a pure function to re-evaluate. Almost every field is now a
plain function of the raw timeline `t` rather than gated on `phase`/`local` (see [The
timeline](#the-timeline-color-scale-and-the-bounding-box)) — `mountScale` is one of them now too
(derived from `TIMELINE`'s `related`-phase window, not a `phase` switch); phase-gating only remains
for `azimuth`/`elevation`, `margin`, and `idleWeight` (whose default-branch value is itself now
composed from a `t`-based ramp — see below). There is no more `seatAdjust` field at all: the gear
lerps to its assembled seat exactly like every other part, with no positional beat past `t = 87`.
Any new behavior
should be added as a new `EngineFrame` field computed the same way — resist the temptation to give
`EngineScene` its own timeline-dependent state.

That said, `EngineScene` **does** own transient, non-choreography state: the hero idle spin offset,
the drag-to-orbit offsets, and the highlight heartbeat pulse (see [Highlight
heartbeat](#highlight-heartbeat-and-the-blackbody-color-ramp)). All three are deliberately kept out
of `EngineFrame` — they're modifiers layered on top of whatever `beats.ts` computes, never fed back
into it, and never persisted across a `setFrame` call in a way that would make scrubbing
order-dependent. See [Interaction](#interaction-drag-to-orbit). (An earlier third piece of
transient state, a decaying scroll-drop impulse driven by a `window` scroll-velocity listener, was
removed outright — see that section.)

`EngineStage.tsx` wires this together with exactly two effects: one boots `EngineScene` via
dynamic `import('./engine/EngineScene')` (three.js never loads during SSR or blocks the initial
bundle) and tears it down on unmount, and the other calls `engine.setFrame(engineFrame(scene))` and
`engine.setHeroIdle(...)` on every `scene` change once loaded. A load or WebGL failure sets
`status: 'fallback'`, which renders the quiet `#f2efe6` frame with the phase caption instead of a
canvas.

## The eight phases

`PhaseId` (from `scene.ts`) is `'hero' | 'traverse' | 'change' | 'failure' | 'second' | 'span' |
'related' | 'success'`. These are still the eight scroll-phase buckets `scene.ts` divides the
timeline into (unchanged phase names/weights), but **the mismatch story's own color, scale, and
bounding-box beats no longer respect these phase boundaries at all** — they're driven directly by
functions of the raw timeline `t` (see [The
timeline](#the-timeline-color-scale-and-the-bounding-box)), so a given color/scale/box transition
can start or end mid-phase, straddle a phase boundary, or span several phases. Only a handful of
`EngineFrame` fields — the camera fields `azimuth`/`elevation`/`margin`, plus `idleWeight` — are
still phase-`switch` functions in the classic sense; `mountScale` has since joined the pure-`t`
group (see [The timeline](#the-timeline-color-scale-and-the-bounding-box)), and `seatAdjust` no
longer exists — see
[`beats.ts#L266-L318`](../../packages/website/app/components/marketing/story/engine/beats.ts#L286-L338).

Phase boundaries (`t`, from `TIMELINE` in `scene.ts`): `hero` 0–6.06, `traverse` 6.06–18.18,
`change` 18.18–36.36, `failure` 36.36–54.55, `second` 54.55–66.67, `span` 66.67–78.79, `related`
78.79–96.97, `success` 96.97–100.

| Phase | What happens physically |
|---|---|
| `hero` | The engine sits assembled, viewed end-on down its crankshaft axis as it would present mounted in a car (`HERO_AZIMUTH = π`, `HERO_ELEVATION = 6°`), slowly idle-orbiting; the instant scrolling begins (`t` above 0, still inside `hero`) explosion, the camera's pull-back to the canonical angle, and the margin's tightening all start ramping on one shared curve, `heroTraverseProgress(t)` |
| `traverse` | Continues the same `heroTraverseProgress(t)` curve `hero` started — explode, azimuth/elevation, and margin all reach their canonical/fully-exploded values and hold flat at `CAMERA_SETTLE_T` (`t = 12.3`), well before `traverse` itself ends (`t = 18.18`); the idle orbit has already faded out over a short leading fraction of the span; the gear, pistons, and `engineBackCover` pulse orange starting at `t = 7.5` (`preHighlightOrange`), foreshadowing which parts the story is about, and the gear starts growing/turning blue at `t = 16`, straddling into `change` |
| `change` | The gear (only) continues growing to `FRONT_SCALE` (1.25×) and finishes its orange→blue transition by `t = 24`; the pistons and `engineBackCover` go straight from orange to red over the same `t = 16–24` window; the orange pre-highlight itself fades out over `t = 20–28`, crossfading directly into the window below rather than into the gear's blue |
| `failure` | The gear's own second color stage: blue → red over `t = 28–41`, resolving to the same red the pistons and `engineBackCover` already locked in at `t = 24`. There is no longer a residual, unclosed reassembly gap here — `frontDriveExplode` tracks `explode` exactly (see [`frontDriveExplodeAt`](#the-timeline-color-scale-and-the-bounding-box)); the beat is now told entirely through color and scale, not through the model failing to seat |
| `second` | Every highlighted part fades to no color at all and the gear shrinks back to 1× over `t = 46–60`; a translucent green bounding box (see [The mismatch bounding box](#the-mismatch-bounding-box)) fades in around the gear/pistons/`engineBackCover`, peaking at `t = 60` |
| `span` | The bounding box fades back out over `t = 60–72` as the gear, pistons, `engineBackCover`, and the mount all fade up to the same shared, permanent green (`finalGreen`) — the box and the green highlight are never both fully on; they hand off exactly at `t = 60` |
| `related` | The gear grows back to `FRONT_SCALE` over `t = 72–83`; `engineBackCover` resizes to `MOUNT_SCALE` over the first 0.1–0.7 of this phase's own span (`mountScaleAt`, derived from `TIMELINE`'s `related` window rather than hardcoded); the whole engine's final reassembly (exploded → assembled) plays out over `t = 83–87`, entirely inside this phase |
| `success` | The camera holds the final assembled framing; nothing else moves until `RETURN_TO_NORMAL_START_T` (`t = 93`, inside this phase), when the shared green releases, the gear and mount ease back to 1×, and the idle-orbit weight fades back in, so the engine ends the timeline (`t = 100`) exactly as `hero` began it — fully assembled, natural colors and sizes, slowly turning. There is no `seatAdjust`/seat-remap beat any more; the gear was never lifted off its seat to begin with (see [Pose model](#pose-model-how-exploded-is-derived-read-this-before-touching-poses)) |

There is no more `FAIL_STOP` residual-gap constant, no amber linkage line, and no per-phase camera
push-in/pull-back for `failure`/`second`/`success` — all three were removed as part of the retiming
that produced the color/scale/box story above; see [Camera
framing](#camera-framing-atmosphere-and-the-never-cropped-constraint) and [The
timeline](#the-timeline-color-scale-and-the-bounding-box).

Each `*At` function in
[`beats.ts`](../../packages/website/app/components/marketing/story/engine/beats.ts) is either a
plain `switch` over `PhaseId` (still true for the camera fields and `idleWeight` — **a value
not respecified for a later phase holds at its previous phase's end value**, with no `default`
fallthrough, so a missing `case` is a TypeScript exhaustiveness error by design) or a pure function
of `t` composed from `ramp()` calls (true for every color/scale/box field, and now `mountScale` too
— see [The timeline](#the-timeline-color-scale-and-the-bounding-box) for that composition
technique). When
adding a new phase-gated field, decide explicitly whether it should hold, reset, or animate, and
write every `switch` case; when adding a new `t`-gated beat, follow the additive/subtractive
`ramp()` composition pattern the existing beats already use rather than introducing a parallel
phase switch.

## Pose model: how "exploded" is derived (read this before touching poses)

This is the least obvious part of the system and the one most likely to break silently if touched
without context.

The source model ships one baked animation clip in the GLB (assimp's `"Take 001"`, ~984 channels).
It is **not** an authored exploded-view constellation — verification during the build found it to
be a **sequential one-part-at-a-time fly-in**: at frame 0, parts are parked in arbitrary off-stage
staging positions (not a clean "pulled back along its axis" pose), and they fly in to their
assembled seat one after another as the clip plays. Naively sampling frame 0 as "exploded" and the
last frame as "assembled" renders a scattered speck cloud, not an engine.

[`EngineScene.load()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L330-L584)
handles this in two steps:

1. **Bake assembled poses from the last frame.** The `AnimationMixer` must be set to
   `THREE.LoopOnce` with `clampWhenFinished = true` before calling `mixer.setTime(clip.duration)`.
   With the default `LoopRepeat`, `setTime` wraps the duration back to frame 0, so both the
   "staging" and "assembled" samples silently capture the same pose. This exact bug shipped in the
   first draft.
2. **Synthesize exploded poses from the authored assembly axis, not raw staging distance**, in two
   passes. Pass one computes each part's raw staging→assembled direction and distance, and
   separately averages the "healthy" reference parts' directions
   (`EXPLODE_DIRECTION_REFERENCE = ['belt', 'throttleBody']`) into `healthyDirection`. Pass two
   builds the actual exploded pose: for most parts, direction is the reversed staging→assembled
   axis (what the staging frame reliably carries) and distance is the raw staging distance
   compressed by `rawDistance / (rawDistance + modelRadius)` into
   [`EXPLODE_MIN_FRACTION`, `EXPLODE_MAX_FRACTION`]
   ([`EngineScene.ts#L56-L57`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L63-L64),
   currently 0.54–1.89 of the model's bounding radius — the product of two tuning passes: first
   tripled from an original 0.30–1.05 for a wider, more camera-friendly constellation, then reduced
   by roughly 40% in a follow-up pass that tightened the exploded-view zoom). A part listed in
   `EXPLODE_OVERRIDES` adjusts this: `direction: 'reference'` or `'frontReference'` substitutes an
   averaged reference axis for the part's own (unreliable) axis, and
   `minDistanceFraction`/`maxDistanceFraction` floor/cap the distance as a fraction of the model
   radius — see
   [`parts.ts`'s `EXPLODE_OVERRIDES`](../../packages/website/app/components/marketing/story/engine/parts.ts#L137-L231)
   and
   [`EXPLODE_DIRECTION_REFERENCE`](../../packages/website/app/components/marketing/story/engine/parts.ts#L273-L291).
   `gear` (`direction: 'reference'`, floor 0.9 — its own baked displacement is too small and not
   reliably outward) and `engineBackCover` (`direction: 'own'`, cap 0.63) are the original pair,
   whose capped/floored fractions preserve the **ordering invariant** that the gear stays outboard
   of the cover it seats against at every blend weight (see the code comment on that entry for the
   full derivation). `engineBlockCylinderLeft`/`Right` (`direction: 'own'`, cap 1.0) fix an analogous
   ordering bug one bank down (block overtaking its own cylinder head), and `piston001`–`piston008`
   (`direction: 'own'`, cap 0.5) fix a third instance of the same family of bug (pistons parking
   inside their bank's cylinder head). `belt`/`crankshaftSprocket`/`camshaftSprocket` and
   `camshaft`/`crankshaft`/`engineBlockFront` round out the remaining entries, fixing unreliable
   directions and shaft/tip overtaking at the front-drive end via a second, independent
   `EXPLODE_DIRECTION_REFERENCE_FRONT` reference (`['engineBlockFront']`) — see the code comments on
   each entry in `parts.ts` for the specific geometry each one addresses. Orientation and scale are
   held at their assembled values throughout; a technical exploded view translates parts, it
   doesn't tumble them.

A part whose track never actually moves it (assembled ≈ staging) falls back to exploding radially
away from the model centroid instead of a zero-length axis.

### Trap: the mesh-name dedup-suffix bug

`GLTFLoader` renames a mesh whenever it shares a name with its own wrapper node in the source FBX
— the *second* claimant of a name gets suffixed (`gear` → `gear_1`, `belt` → `belt_1`,
`crankshaftSprocket` → `crankshaftSprocket_1`, `camshaftSprocket` → `camshaftSprocket_1`). An
earlier version of this code matched `FRONT_DRIVE`/`FRONT_MOUNT` membership against the live mesh
name with an exact-match `Set`, which silently missed 4 of the 5 (at the time) `FRONT_DRIVE`
parts — only `throttleBody` and the (now-retired) `engineBlockFront` mount ever matched. That's why
the gear never resized or glowed in the earliest version of this system.

The fix is [`stripDedupSuffix()`](../../packages/website/app/components/marketing/story/engine/parts.ts#L92-L94)
— every membership check in this system (`FRONT_DRIVE`, `FRONT_MOUNT`, `ORANGE_EMPHASIS`,
`EXPLODE_OVERRIDES`, `EXPLODE_DIRECTION_REFERENCE`) strips a trailing `_<n>`
before comparing. If a future re-export changes which meshes collide with wrapper-node names, a
part can silently drop back out of these lists in exactly this way — if a part stops
resizing/highlighting/glowing, check whether its live mesh name carries a dedup suffix before
assuming the list itself is wrong.

After baking, the imported `gltf.scene` (and its `$AssimpFbx$` pivot chains, an assimp FBX import
artifact) is discarded. Every part becomes a fresh flat-hierarchy `THREE.Mesh` sharing the original
geometry, parented directly under one `THREE.Group` — there is no scene graph depth to reason about
at render time, just a flat `PartRecord[]`
([`types.ts#L12-L23`](../../packages/website/app/components/marketing/story/engine/types.ts#L12-L23)),
which also carries each part's `isFrontDrive`/`isMount`/`isOrangeEmphasis` flags precomputed at
load time. (There is no `isSeatAdjust` flag any more — the seat-remap degree of freedom it drove
has been removed outright, see [The timeline](#the-timeline-color-scale-and-the-bounding-box).)

## Materials: why there is no albedo texture

The source FBX's baked albedo photo-texture paints the cylinder-head covers bright red with a
visible "V8" logo — both unacceptable, since red is reserved for the mismatch highlight and a baked
logo shouldn't ship. The runtime assigns materials by **part family** instead:
[`parts.ts`](../../packages/website/app/components/marketing/story/engine/parts.ts#L22-L69) maps
every mesh name to one of nine families (`castIronDark`, `castIron`, `castIronLight`,
`frontCover`, `rotating`, `aluminum`, `polymer`, `rubber`, `hardware`) via longest-prefix,
case-insensitive matching, and
[`FAMILY_MATERIAL`](../../packages/website/app/components/marketing/story/engine/parts.ts#L71-L84)
gives each a flat color/roughness/metalness. The structure family is split three ways so the
engine's mass reads as assembled castings rather than one flat surface: `castIronDark` for the oil
pan (`#3f4247`, roughness 0.65/metalness 0.8, the darkest — a sand-cast part), `castIron` for the
block, `engineBackCover`, and the unmatched-name fallback (`#4a4d52`, 0.6/0.85), and `castIronLight`
for the side covers (`#54575d`, 0.55/0.85). All families still share the GLB's normal, roughness,
and AO detail maps (loaded in
[`EngineScene.load()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L438-L452)
and wired into each family's material in
[`materialFor()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L596-L611))
for surface realism — only the color layer is synthetic. The studio HDRI environment map (see
[Rendering](#rendering-tone-mapping-studio-hdri-and-selective-bloom)) is what most recently changed
how these families actually read on screen, but the family/color assignment itself is unaffected.

The source naming has real inconsistencies that `familyOf` must tolerate:
`cylinderHeadCoverleft` (lowercase `l`) vs `cylinderHeadCoverRight`, and `intakeManifoldleft` vs
`intakeManifoldRight`. Matching is case-insensitive and prefix-based specifically to survive this.
If a future GLB re-export changes a mesh name, `familyOf`'s fallback (`hardware` for anything
containing "bolt"/"nut", `castIron` otherwise) prevents a silent crash but will look wrong — check
the mesh-name list in
[`parts.ts`](../../packages/website/app/components/marketing/story/engine/parts.ts) against the new
export.

`FRONT_DRIVE` and `FRONT_MOUNT`
([`parts.ts#L105-L117`](../../packages/website/app/components/marketing/story/engine/parts.ts#L105-L117))
are the two lists that drive the whole mismatch narrative. `FRONT_DRIVE` used to hold all five
front-accessory-drive parts (`belt`, `crankshaftSprocket`, `camshaftSprocket`, `gear`,
`throttleBody`); a story re-scope narrowed it to `['gear']` alone, so belt/sprockets/throttleBody
now render as ordinary static geometry and never highlight, resize, or glow — only the ring gear
does. `EngineScene` derives `frontDriveParts` and the highlight-record count from this list's
length, so the narrowing automatically collapsed those from five to one each. `ORANGE_EMPHASIS`
([`parts.ts#L233-L248`](../../packages/website/app/components/marketing/story/engine/parts.ts#L256-L271))
is a third, independent list — the 8 piston bodies, which share the gear's pre-highlight orange and
carry their own red beat (`pistonRed`) without resizing or joining `FRONT_DRIVE`. All three lists
are matched post [`stripDedupSuffix`](#trap-the-mesh-name-dedup-suffix-bug). `FRONT_MOUNT`
(`['engineBackCover']`) is the mesh that receives the highlight and resize on the other side.
`FRONT_MOUNT` was moved here from `engineBlockFront` because `engineBackCover` is externally
visible from the canonical camera angles, avoiding the depth-test tricks a buried mount would need
— see [Highlight records, diffuse recoloring, and the highlight heartbeat](#highlight-records-diffuse-recoloring-and-the-highlight-heartbeat). Changing which
physical parts tell the story is a one-line edit here, not in `EngineScene.ts` or `beats.ts`.

## The timeline: color, scale, and the bounding box

The mismatch story used to be told through per-phase `switch` functions on `PhaseId`/`local`. It
has been substantially retimed and is now told almost entirely through composed pure functions of
the raw timeline `t`
([`beats.ts#L134-L225`](../../packages/website/app/components/marketing/story/engine/beats.ts#L137-L228)),
independent of phase boundaries:

```
t 7.5-8    orange pre-highlight ramps in on gear + pistons + engineBackCover
t 16-24    the gear turns orange -> blue and grows to FRONT_SCALE; the pistons and
           engineBackCover go straight orange -> red on the same window (see pistonRedAt)
t 20-28    the orange pre-highlight fades out on the gear, crossfading into the window below
           rather than into the gear's intermediate blue
t 28-41    the gear (only) goes blue -> red, resolving to the same red the pistons and
           engineBackCover already locked in at t24
t 46-60    every highlighted part fades to no color at all, the gear shrinks back to 1x,
           and a translucent green-glass bounding box fades in around the gear/pistons/back plate
t 60-72    the bounding box fades back out as gear + pistons + engineBackCover + the mount
           all fade up to the same shared green
t 72-83    the gear grows back to FRONT_SCALE
t 83-87    the whole engine reassembles (see explodeAt)
t 93-100   RETURN_TO_NORMAL: the shared green releases off gear/pistons/engineBackCover/mount,
           the gear and mount ease back to 1x, and the idle-orbit weight fades back in -- the
           engine ends the timeline exactly as `hero` began it, slowly turning
```

Every one of these beats is built from the same `ramp(t, start, end)` primitive (`scene.ts`'s
0..1 clamp-and-normalize helper), composed additively/subtractively so a part's weight can rise for
one window and fall for the next without an explicit phase switch — e.g.
[`mismatchRedAt`](../../packages/website/app/components/marketing/story/engine/beats.ts#L198-L200)
is `ramp(t, MISMATCH_RED_START_T, MISMATCH_RED_END_T) - ramp(t, COLOR_LOSS_START_T,
COLOR_LOSS_END_T)`: it rises across `t 28-41` and falls back across `t 46-60`, with nothing in
between needing special-casing. This is the same technique
[`explodeAt`](../../packages/website/app/components/marketing/story/engine/beats.ts#L142-L144) uses
to compose the initial explode with the final-reassembly collapse
(`FINAL_REASSEMBLY_START_T`/`END_T`, `t = 83`/`87`) into one curve. **None of these beats are undone
by anything earlier than `RETURN_TO_NORMAL_START_T` (`t = 93`)** — once a stage locks in
(`finalGreenAt`'s green, the gear/mount resize, the box handoff), it holds until that final release
window, exactly one deliberate exception to the "never undone" rule. Over `t = 93–100`,
`RETURN_TO_NORMAL_START_T`/`END_T`
([`beats.ts#L181-L182`](../../packages/website/app/components/marketing/story/engine/beats.ts#L181-L182))
compose a shared subtractive ramp into `finalGreenAt`, `scaleWeightAt`, and `mountScaleAt`, and an
additive one into `idleWeightAt`'s default branch — the same additive/subtractive `ramp()`
technique every other multi-stage beat in this file already uses, just run in reverse to bring the
"permanent" mismatch-story state back to rest on purpose. This also fixed a user-visible bug: the
ring gear used to visibly "drop" at the success boundary (~`t = 97`) when an earlier `seatAdjust`
beat remapped its seat onto the resized mount; there is no positional beat of any kind past `t =
87` any more (see below).

`frontDriveExplodeAt` now simply returns `explodeAt(t)` — the gear no longer stalls at a partial,
unclosed gap the way an earlier version of this system did (see [The eight
phases](#the-eight-phases)); it moves in unison with the rest of the body for both the initial
explode and the final reassembly. The oversize beat itself
([`scaleWeightAt`](../../packages/website/app/components/marketing/story/engine/beats.ts#L326-L333))
is four chained `ramp()`s: grow at `RING_BLUE_START_T..END_T` (`t 16-24`), shrink at
`COLOR_LOSS_START_T..END_T` (`t 46-60`), regrow at `RING_REGROW_START_T..END_T` (`t 72-83`), then
ease back to 1× for good at `RETURN_TO_NORMAL_START_T..END_T` (`t 93-100`) — the gear's size
genuinely cycles 1× → `FRONT_SCALE` → 1× → `FRONT_SCALE` → 1× over the story, in lockstep with its
own color beats. `mountScaleAt`
([`beats.ts#L258-L262`](../../packages/website/app/components/marketing/story/engine/beats.ts#L278-L282))
now composes the same way, purely as a function of `t`: it grows across `MOUNT_GROW_START_T..END_T`
(derived from `TIMELINE`'s `related`-phase span at local `0.1..0.7`, not hardcoded — see
[`beats.ts#L249-L251`](../../packages/website/app/components/marketing/story/engine/beats.ts#L252-L254)),
holds, then eases back to 1× over the same `RETURN_TO_NORMAL` window as the gear. There is no
separate "lift off its seat" degree of freedom in the current system — an earlier version had one
(`frontDriveLift`/`FRONT_LIFT_FRACTION`); it has been removed entirely. There is also no more
`seatAdjust`/`seatAdjustAt`/`FRONT_DRIVE_SEAT_ADJUST` degree of freedom: an earlier version remapped
the gear's seat target radially onto the resized mount once `related`/`success` began, and the
`updatePartTransforms` gear-only remap block that applied it is gone too — the gear now `lerp`s to
`part.assembled.position` exactly like every other part, for the whole timeline including the
`RETURN_TO_NORMAL` window. The gear now only resizes and recolors in place.

### The mismatch bounding box

A box of green glass fades in around just the mismatch story's own parts (gear, pistons,
`engineBackCover` — not the whole engine) while every highlight is dark (`frame.boxWeight`, `t
46-60`, peaking at 60), then fades back out as those parts resolve to the shared green (`t 60-72`).
It's a fixed prop: sized/positioned once at load time from those parts' *exploded* pose
([`computeMismatchBoxBounds()`](../../packages/website/app/components/marketing/story/engine/mismatchBox.ts#L34-L61))
rather than tracked live, since explode is held flat for this entire window — nothing it encloses
moves.
[`buildBoundingBox()`](../../packages/website/app/components/marketing/story/engine/mismatchBox.ts#L78-L123)
returns a `THREE.Group` with two children: a lit `MeshPhysicalMaterial` "green glass" fill mesh
(`BOUNDING_BOX_GLASS_GREEN = '#0c8a60'`, a deep emerald, `metalness: 0`, `roughness: 0.12`,
`clearcoat: 1`/`clearcoatRoughness: 0.08` for an HDRI/env sheen, `DoubleSide`, `depthWrite: false`,
`fog: false`) padded by `BOUNDING_BOX_PADDING` (1.02 — tightly containing the parts' silhouette, not
floating loosely around them) and an `EdgesGeometry`/`LineSegments` outline on top of it, still
tinted `HIGHLIGHT_GREEN` (the shared highlight color, not the glass color). The fill deliberately
does **not** use the mint `HIGHLIGHT_GREEN` the way the edges do: at glass-level opacity over the
cream page, that lighter mint washes out to near-white, so the fill uses the much deeper
`BOUNDING_BOX_GLASS_GREEN` instead — a lit `MeshPhysicalMaterial` also gives the box real
specular/clearcoat sheen from the scene's HDRI and key light instead of a flat unlit wash, and
`DoubleSide` lets the box's far faces show through its near ones, which is what sells it as a glass
volume rather than a solid card. The `EdgesGeometry` outline is still needed on top for legible
corners, since even a lit fill doesn't give a translucent volume crisp edges on its own.
[`updateBoundingBox()`](../../packages/website/app/components/marketing/story/engine/mismatchBox.ts#L231-L241)
drives only opacity/visibility per frame: `BOUNDING_BOX_MAX_OPACITY` (0.45) for the fill,
`BOUNDING_BOX_EDGE_OPACITY` (0.7) for the outline. The box is deliberately never touched by the
[highlight heartbeat pulse](#highlight-heartbeat-and-the-blackbody-color-ramp) — it's a plain
static/steady prop, not one of the pulsing highlights.

**The bloom-pass opacity bug.** The box used to render as far more opaque than
`BOUNDING_BOX_MAX_OPACITY` should have allowed — even at low `boxWeight` it could read as a
near-solid slab rather than a translucent volume. The root cause was in the bloom pass, not in the
box's own material: [`darkenNonBloomed`](#rendering-tone-mapping-studio-hdri-and-selective-bloom)
swapped every non-glowing mesh (including the box's fill) to the opaque black `DARK_MATERIAL` for
the bloom-only render, which wrote `alpha = 1` across the box's whole silhouette into the bloom
buffer; the `mixPass` shader (`base + bloom`) sums alpha as well as color, so on this canvas's
`alpha: true` page composite the box region ended up fully opaque and displayed its premultiplied
RGB raw — near-black at low weight, saturated green at peak — instead of a translucent tint over
the cream page. (An earlier hypothesis blamed `DoubleSide` double-face compounding for the
near-opaque look; that was disproven once the actual alpha-summing mechanism above was traced
through the bloom/mix pipeline.) The fix, in
[`EngineScene.render()`](#rendering-tone-mapping-studio-hdri-and-selective-bloom), hides the box
group outright for the bloom pass — rather than darkening it like an ordinary mesh — then restores
its frame-appropriate visibility before the main pass; see [Rendering: selective
bloom](#rendering-tone-mapping-studio-hdri-and-selective-bloom) for the exact sequencing.

## Rendering: tone mapping, studio HDRI, and selective bloom

**Tone mapping.** The constructor sets
[`this.renderer.toneMapping = THREE.ACESFilmicToneMapping`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L335-L345)
with `toneMappingExposure = 1.15`. This replaced an earlier `AgXToneMapping` pick once the
emissive/bloom highlight pass (below) existed: AgX rolls off highlights hard by design, which
crushed exactly the brightness range `UnrealBloomPass`'s threshold needs to read cleanly to tell
"hot" emissive pixels from ordinary lit metal. ACES keeps a similar filmic shoulder on the
gray-metal families while letting genuinely bright emissive values clear the bloom threshold
instead of being pre-crushed toward the AgX gamut boundary. This tone-mapping choice is directly
entangled with the highlight-color tuning below — see [Highlight
heartbeat](#highlight-heartbeat-and-the-blackbody-color-ramp) for why ACES's own highlight
desaturation (not fog, not hue math) was the root cause of an earlier "highlight colors read washed
out" bug, and how the fix required both a lower emissive magnitude and direct diffuse recoloring.

**Studio HDRI environment.** An equirectangular HDRI —
[`studio_small_08_1k.hdr`](../../packages/website/app/assets/engine/) (Poly Haven, CC0), loaded via
`RGBELoader` and converted through `THREE.PMREMGenerator` into a PMREM environment map
([`EngineScene.load()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L436-L468)).
This gives real softbox/rim gradients across the machined faces (ring gear, cylinder-head covers)
instead of a flat ambient wash. `scene.environmentIntensity` is `1.1` and
`scene.environmentRotation` is `new THREE.Euler(0, Math.PI * 0.35, 0)` — both tuned against
screenshots across the timeline: intensity high enough that the softbox gradient reads on the
aluminum/cast-iron faces without blowing out the light parts, rotation chosen so the HDRI's
brightest softbox falls across the three-quarter camera angle rather than directly behind the lens.
`scene.background` stays `null` throughout — the canvas is transparent (`alpha: true`) over the
cream page background, and the environment map must never paint over it. `vite.config.ts`'s
`assetsInclude` covers `**/*.hdr` alongside `**/*.glb` so the HDRI loads as a static asset the same
way the GLB does.

**Selective bloom.** Highlighted parts glow via the classic "darken non-bloomed materials"
technique, not camera-layer exclusion (an earlier version restricted the bloom pass's camera to
`BLOOM_LAYER` only, which meant opaque parts were never drawn at all in that pass — glowing parts
never depth-tested against them and their glow bled through parts that should have occluded them).
The constructor builds two `EffectComposer`s
([`EngineScene.ts#L215-L276`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L215-L276)):
`bloomComposer` renders the full scene through the same camera, with every mesh not on
`BLOOM_LAYER` (`= 1`) temporarily swapped to a flat black `DARK_MATERIAL` (`fog: false`, so
distant/fogged parts can't accidentally cross the bloom threshold on their own — see
[`darkenNonBloomed`/`restoreMaterial`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L889-L902)),
through `UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.35, 0.92)` (threshold/strength/radius);
`composer` does the normal full-scene render and a custom `mixPass` `ShaderPass` adds the bloom
texture back on top additively, followed by `OutputPass` for the final sRGB conversion.
[`render()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L815-L836)
runs both passes every frame in sequence, with the [mismatch bounding
box](#the-mismatch-bounding-box) handled specially: hide the box group outright (not merely
darkened — see [the bloom-pass opacity bug](#the-mismatch-bounding-box) for why an opaque
darkened stand-in broke its translucency) → darken every other non-bloomed mesh → render the
bloom-only pass → restore materials → restore the box's frame-appropriate visibility via
`updateBoundingBox(this.boundingBox, this.currentFrame?.boxWeight ?? 0)` → render the normal pass
with the bloom mix. Hiding the box for the bloom pass also keeps its `LineSegments` edge outline
(which `darkenNonBloomed`'s `isMesh` check never swaps, since it isn't a `Mesh`) from feeding the
bloom threshold on its own. `updateHighlights()` (below) is what enables/disables `BLOOM_LAYER` on
a part per-frame, purely as a lookup marker for `darkenNonBloomed` — it plays no role in
camera/render exclusion. Only parts with a genuinely nonzero highlight ever bloom; ordinary
specular highlights on lit metal (from the key light/HDR environment) never cross the threshold.

## Highlight records, diffuse recoloring, and the highlight heartbeat

Highlight color/intensity is driven directly on each highlightable part's own material — there is
no separate overlay/shell mesh. An earlier version of this system added slightly-oversized
additive-blended "shell" meshes as children of each part instead; those read as a visible separate
glowing container around the part rather than the part's own surface glowing, and needed their own
independent fog handling that never quite matched the real part underneath. That shell architecture
(`ShellRecord`, `buildHighlightShells()`) and the amber linkage line that ran between the gear and
the mount (`buildLinkageLines()`, `LINK_AMBER`) have both been removed outright — the linkage was
replaced by [the translucent bounding box](#the-mismatch-bounding-box) at the user's explicit
request; see the [Related pages](#related-pages) history if reconstructing that period's design.

### Highlight records

Highlightable parts (`isFrontDrive || isMount || isOrangeEmphasis`) get their own material clone
rather than the family's shared instance
([`EngineScene.load()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L715-L719))
— `updateHighlights` drives emissive/color directly on each one, and a shared material would leak
one part's glow onto every other part of the same family.
[`buildHighlightRecords()`](../../packages/website/app/components/marketing/story/engine/highlights.ts#L171-L221)
builds one `HighlightRecord`
([`highlights.ts#L41-L51`](../../packages/website/app/components/marketing/story/engine/highlights.ts#L41-L51))
per highlightable part: its mesh, its own unhighlighted albedo captured once (`baseMaterialColor`),
and an ordered list of `HighlightStage`s
([`highlights.ts#L26-L32`](../../packages/website/app/components/marketing/story/engine/highlights.ts#L32-L38))
— each a `HighlightKind` (`'blue' | 'ringRed' | 'red' | 'pistonRed' | 'orange' | 'finalGreen'`,
[`highlights.ts#L24`](../../packages/website/app/components/marketing/story/engine/highlights.ts#L28-L28))
paired with that kind's cold-state identity color. The gear (front-drive) carries
`orange → blue → ringRed → finalGreen`; the mount (`engineBackCover`) carries
`orange → red → finalGreen`; each piston (`orangeEmphasisParts`) carries
`orange → pistonRed → finalGreen`. Because a crossfade window can have two stages simultaneously
active (e.g. `ringBlueAt`/`mismatchRedAt` sum to a smooth handoff across `t 28-41`), a record's
stage list is not mutually exclusive at any given frame — `updateHighlights` sums every active
stage's contribution rather than assuming only one is ever nonzero.

### `updateHighlights()`: the diffuse+emissive fix for washed-out colors

[`updateHighlights()`](../../packages/website/app/components/marketing/story/engine/highlights.ts#L229-L283)
runs once per frame per record. For each active stage (`intensity >= 0.001`, via
[`intensityForKind`](../../packages/website/app/components/marketing/story/engine/highlights.ts#L175-L190)
reading the matching `EngineFrame` field) it computes a `heat` value and a `stageIntensity`, both
scaled by the stage's `tier`
([`tierForKind`](../../packages/website/app/components/marketing/story/engine/highlights.ts#L192-L204):
`EMISSIVE_TIER_HIGH` 0.55 for the red family, `EMISSIVE_TIER_MID` 0.45 for blue/finalGreen,
`EMISSIVE_TIER_LOW` 0.5 for orange) and by the [heartbeat pulse](#highlight-heartbeat-and-the-blackbody-color-ramp)'s
current weight. `heat` feeds
[`blackbodyColor()`](../../packages/website/app/components/marketing/story/engine/highlights.ts#L161-L180),
which ramps a stage's cold identity hue toward a hotter, more saturated peak as `heat` rises
(clamped well under 1 via `HEARTBEAT_HEAT_PEAK_CAP` so a fully-active highlight at pulse peak reads
as hot-orange/red, never near-white). This is emissive, and used to be the *only* thing driving a
part's color — but emissive alone, added on top of a part's real (often near-neutral gray metal)
diffuse+specular shading under the HDR environment, reads as a pale tint rather than a vivid color,
because the achromatic base dominates the additive sum regardless of the emissive's magnitude (and
raising the magnitude to compensate just pushes the sum into
[ACESFilmicToneMapping](#rendering-tone-mapping-studio-hdri-and-selective-bloom)'s highlight
rolloff, which desaturates bright pixels toward white — the actual root cause of a real,
screenshot-verified "not saturated enough" bug this session, misdiagnosed at first as a fog
problem). The fix is two-part: `EMISSIVE_SCALE` (0.32) and `HEARTBEAT_HEAT_PEAK_MULTIPLIER` (1.15)
are kept low enough that the emissive sum stays under the tonemapper's shoulder, **and**
`updateHighlights` also actively mixes `material.color` itself from `baseMaterialColor` toward an
`identityColor` — the active stage(s)' base hue(s), weighted by raw intensity only (not
tier/heat/pulse-scaled, since "this part is now the red one" is a state independent of how hot the
heartbeat happens to be reading at this instant). The surface's own albedo actually becomes that
color; the emissive/bloom on top is then just the hot pulse accent, not the sole source of the
color. `material.emissiveIntensity` is pinned to `1` since the summed `total` color already carries
the full per-stage scaling. `BLOOM_LAYER` is enabled on a part only while its combined emissive
`magnitude` is at least `0.01`.

### Highlight heartbeat and the blackbody color ramp

Every highlight (all kinds alike, including `orange`) pulses at a steady real-time rate,
`HEARTBEAT_HZ = 0.75` (~45 BPM,
[`highlights.ts#L61`](../../packages/website/app/components/marketing/story/engine/highlights.ts#L71-L71)),
via
[`pulseWave()`](../../packages/website/app/components/marketing/story/engine/highlights.ts#L76-L78)
— a single continuous `(1 - cos(2π·cycle)) / 2` breathe with no flat rest segment or hard corner,
so scrubbing/wrapping never pops. This is layered on top of whatever intensity `EngineFrame`
already computed; it never changes *whether* a part is glowing, only how hot it glows while it is.
`pulseCycle`/`pulseWeight` are advanced every tick of the [shared motion
driver](#the-shared-motion-driver) (`motionTick`,
[`EngineScene.ts#L669-L723`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L945-L999)),
entirely independent of scroll position — the heartbeat keeps beating at a constant real-time rate
regardless of scrub direction or speed. It's pinned to 0 (no accumulation) under
`prefers-reduced-motion` (`setReducedMotion`,
[`EngineScene.ts#L552-L561`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L611-L620)).
[`blackbodyColor(base, heat)`](../../packages/website/app/components/marketing/story/engine/highlights.ts#L161-L180)
is the color ramp itself: for `heat` in `[0, 0.5]` it rises from a dim ember of `base`'s own hue
toward that hue's natural lightness with only a mild warm-hue nudge (so each kind's identity reads
clearly through the first half); for `[0.5, 1]` it lightens/saturates further toward a vivid hot
peak (`BLACKBODY_PEAK_LIGHTNESS` 0.52, `BLACKBODY_PEAK_SATURATION` 0.92) — saturation is kept high
all the way to peak, unlike a literal blackbody curve (which would desaturate toward white), so the
glow reads as a vivid hot color rather than washing out.

## Camera framing, atmosphere, and the never-cropped constraint

The page's framing rule is that the engine must never touch the media frame's edges, at any beat,
including fully exploded (when the model's footprint is largest). This is solved mathematically
rather than by hand-tuning per-beat camera shots:
[`fitCameraToFrame()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L845-L883)
computes the union bounding sphere of every part's current world position each frame
(`sphereUnion`, a standard two-sphere merge,
[`EngineScene.ts#L96-L111`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L110-L125)),
then places the camera at the distance that fits that sphere plus a margin, accounting for aspect
ratio via `fitFov = min(fovY/2, atan(tan(fovY/2) * aspect))`. `frame.margin` is the one per-beat
tuning knob; everything else in the shot is derived, not staged.

[`marginAt()`](../../packages/website/app/components/marketing/story/engine/beats.ts#L425-L433) is
now simpler than it once was: it only has two cases. For `hero`/`traverse`, it `lerp`s continuously
from `MARGIN_ASSEMBLED` (0.896) to `MARGIN_EXPLODED` (0.68) over `heroTraverseProgress(t)` — the
same shared curve driving explode and the azimuth/elevation approach — so the camera pull-back
starts at the first pixel of scroll and reaches the exploded margin by `CAMERA_SETTLE_T` (`t =
12.3`), holding flat for the remainder of `traverse`. Every other phase holds flat at
`MARGIN_EXPLODED`. There is **no more `MARGIN_FAILURE`, no `MARGIN_PUSH_FRACTION`, and no per-phase
camera push-in/pull-back** for `failure`/`second`/`success` — an earlier version of this system had
one (eased zoom-in at `failure`, zoom-out at `second`, zoom-in again at `success`); it was removed
as part of the retiming that produced [the current color/scale/box
timeline](#the-timeline-color-scale-and-the-bounding-box), since the mismatch story is now told
entirely through color, scale, and the bounding box rather than through camera motion. Both margin
constants are the pre-retiming values × 0.8 — a deliberate ~25%-larger apparent-size pass (smaller
margin ⇒ camera sits closer ⇒ bigger apparent size at a fixed FOV) — and both still sit below 1.0
deliberately: the bounding sphere over-estimates the model's actual (non-isotropic) silhouette, so a
sub-1.0 margin is needed to still land the visible cluster close to the frame edge.

`azimuth`/`elevation` also ride `heroTraverseProgress(t)`: they `lerp` from `HERO_AZIMUTH`/
`HERO_ELEVATION` (π, 6° — the level, end-on-down-the-crankshaft hero shot) to
`CANONICAL_AZIMUTH`/`CANONICAL_ELEVATION` (35°/18°, the three-quarter technical-drawing angle every
later phase holds) across `hero` and `traverse` on the same curve — settling at `CAMERA_SETTLE_T`
(`t = 12.3`) exactly like `explode` and `margin`, not at the actual end of `traverse` (`t = 18.18`)
— then hold at canonical from `change` onward, plus a slow `AZIMUTH_DRIFT` (+18° over the whole
timeline) that keeps parallax alive while scrubbing without breaking reversibility, itself a pure
function of `t`. `fitCameraToFrame` also layers in the pointer-drag azimuth/elevation offsets
(unconditionally, in every phase) — see [Interaction](#interaction-drag-to-orbit).

**Fog**: `this.scene.fog = new THREE.Fog(STAGE_BACKGROUND, ...)` is set once at
construction to the page's exact background color (`#f2efe6`) — the canvas itself is transparent
(`alpha: true`, clear alpha 0), so fogging to this exact color is what lets distant parts blend into
the page instead of a mismatched haze. `fitCameraToFrame` recomputes `fog.near`/`fog.far` every
frame from the same fitted `distance` and bounding-sphere `radius` it just computed for the camera:
`near = distance - radius * FOG_NEAR_RADIUS_FRACTION` (0.4), `far = distance + radius *
FOG_FAR_RADIUS_FRACTION` (0.55). Because both fractions track the continuously-changing bounding
sphere, the assembled view (small radius, camera close, parts close together) still only lightly
hazes, while the fully exploded view (large radius, camera far) is where the veiling reads
strongest. The highlight materials and the bounding box both opt out (`fog: false`) since they're
story UI overlaid on the scene, not scene geometry proper — the box's own material is a lit
`MeshPhysicalMaterial` (see [The mismatch bounding box](#the-mismatch-bounding-box)), just one that
should never itself fog into the background.

## Interaction: drag-to-orbit

A deliberately transient input path sits alongside the scroll-driven choreography, handled
entirely inside `EngineScene` and never fed back into `SceneState`/`EngineFrame`. (An earlier
"scroll drop impulse" — a `window` scroll-velocity listener that sagged the whole part group and
decayed back to rest — was removed outright in an earlier pass; there is no remaining mention of it
anywhere in the current source.)

**Drag-to-orbit** (all phases). Pointer events on the canvas
([`EngineScene.ts#L610-L658`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L610-L658)) —
`setPointerCapture` on down, `touch-action: pan-y` and `grab`/`grabbing` cursor styling set on the
canvas element in the constructor — accumulate clamped azimuth/elevation offsets
(`DRAG_SENSITIVITY`, `DRAG_AZIMUTH_LIMIT`, `DRAG_ELEVATION_TOTAL_LIMIT`,
[`EngineScene.ts#L77-L80`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L87-L90))
from pointer movement. The signs are inverted from the raw pointer delta so the interaction reads as
grabbing the object itself rather than panning a camera around it: azimuth offset *subtracts* `dx *
DRAG_SENSITIVITY` (dragging left rotates the engine clockwise), and the elevation sign is likewise
flipped (dragging up looks up more). These offsets are blended into `fitCameraToFrame`
**unconditionally** — not gated by `idleWeight` the way the hero idle spin is — so dragging works
identically in every phase, not just the hero. On release, they ease back to zero at
`DRAG_SNAP_BACK_RATE`.

### The shared motion driver

Idle spin, drag snap-back, and the highlight heartbeat pulse are all genuinely time-based (not
purely scroll-driven) motions, and used to risk competing `requestAnimationFrame` loops (a fourth,
the scroll-impulse decay, existed before that motion was removed entirely — see above). They share
one: `ensureMotionLoop()`/`motionTick()`
([`EngineScene.ts#L660-L723`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L667-L730)).
Any of them starting (hero idle turning on, a drag ending, or `setReducedMotion(false)`) calls
`ensureMotionLoop()`, which starts the loop if it isn't already running. Each tick advances all
three (accumulating idle rotation if `heroIdle`, easing drag offsets toward zero if not dragging,
advancing `pulseCycle`/`pulseWeight` unless reduced-motion is on), calls `applyFrame` again, and
the loop stops itself once idle/drag are both settled (reduced-motion gates whether the heartbeat
itself counts toward "settled") rather than running forever or requiring an external stop signal.
The idle accumulator itself is also wrapped here: once `idleAzimuthOffset` accumulates past ±π it's
normalized back into `(-π, π]`, but **only** while `frame.idleWeight === 1` (still in `hero`, at
`l = 0` of `traverse`, or — since `idleWeightAt`'s `RETURN_TO_NORMAL` ramp reaches exactly 1 at
`t = RETURN_TO_NORMAL_END_T` (100) — at the very end of the timeline too) — a raw 2π jump is
invisible to the blended camera azimuth only at full weight, since ±π are 2π-equivalent camera
positions there; wrapping mid-fade would show as a visible snap. The practical effect is that
`traverse`'s idle fade-out (and, symmetrically, the idle-orbit weight resuming through
`RETURN_TO_NORMAL`) only ever has to unwind at most half a turn of accumulated spin, not however
many full turns built up over a long hero hold or a long dwell at `t = 100`. This guard is
unchanged by the `RETURN_TO_NORMAL` addition — it was already written in terms of `idleWeight`
rather than a specific phase, so it applies correctly to the new window with no code change. A render-path
exception inside the tick is caught and logged, never allowed to silently kill the loop — otherwise
the heartbeat/idle spin/drag snap-back would all stop advancing and the scene would only repaint on
the next externally-triggered `setFrame`/`resize` call.

## Hero: the in-car pose and idle rotation

An earlier version of the hero stood the engine on end as a vertical column, reoriented by a
dedicated `computeUprightQuaternion()` that measured the crankshaft's own baked axis and rotated
every part's transform about the model's center each frame. That machinery has been deleted
outright. The hero now shows the engine in its natural, baked-in-the-model orientation (no per-part
reorientation at all) and achieves the "looking down the crankshaft" read purely with the *camera*:
`HERO_AZIMUTH = π` and `HERO_ELEVATION = 6°` (a touch above dead level) place the camera on the
model's −Z side looking toward +Z, the front-drive end — a level, end-on shot down the crank axis,
as the engine would present mounted in a car — instead of `CANONICAL_AZIMUTH`/`CANONICAL_ELEVATION`
(35°/18°, the three-quarter technical-drawing angle every later phase holds).

**The hero → traverse camera move.** `azimuthBaseAt`/`elevationAt`
([`beats.ts#L250-L268`](../../packages/website/app/components/marketing/story/engine/beats.ts#L427-L445))
`lerp` from the hero angle to the canonical angle across `hero` and `traverse` together, riding
`heroTraverseProgress(t)`
([`beats.ts#L82-L84`](../../packages/website/app/components/marketing/story/engine/beats.ts#L98-L100)) —
one continuous, monotonic curve spanning from the top of `hero` (`t = 0`, fully assembled, hero
angle) to `CAMERA_SETTLE_T` (`t = 12.3`, fully exploded, canonical angle), where it settles and
holds flat, rather than the actual end of `traverse` (`t = 18.18`) it once rode all the way to. The
retime keeps the framing rock-stable while `traverse`'s prose ("Your code is full of relationships
it can't express.") is on screen, instead of the camera still visibly rotating/pulling back well
after that copy appears. `explodeAt`, `frontDriveExplodeAt`, and `marginAt` all ride the same curve
for their own hero/traverse blends (see [Camera
framing](#camera-framing-atmosphere-and-the-never-cropped-constraint)) — sharing one curve instead
of gluing separate hero and traverse curves at the phase boundary is what guarantees the motion has
no seam exactly where `hero` hands off to `traverse`, and what makes it start at the very first
pixel of scroll rather than waiting for `traverse` to begin. `CAMERA_SETTLE_T` is deliberately
distinct from `TRAVERSE_END_T` (`traverse`'s actual phase-boundary end, ~18.18): `idleWeightAt`
(below) still fades against `TRAVERSE_END_T`, not `CAMERA_SETTLE_T` — the two settle timings serve
different purposes and were not meant to move together.

**Idle rotation.** The hero's idle spin itself is unchanged in mechanism: a
`requestAnimationFrame`-driven `idleAzimuthOffset` (ticked by the [shared motion
driver](#the-shared-motion-driver)) accumulates at `HERO_IDLE_RATE` (one turn per 45s) while
`setHeroIdle(true)`. `EngineFrame.idleWeight`
([`idleWeightAt`](../../packages/website/app/components/marketing/story/engine/beats.ts#L296-L304),
1 throughout `hero`, fading to 0 over `IDLE_FADE_FRACTION` (0.3) of the hero+traverse span
(`TRAVERSE_END_T`) — starting at the first pixel of scroll, not at the top of `traverse` — then
ramping back to 1 over `RETURN_TO_NORMAL_START_T..END_T`, `t = 93-100`, so the idle turntable
resumes right where the engine ends up fully assembled again) blends that accumulated offset into
the camera azimuth
([`fitCameraToFrame()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L1068-L1068))
so the first scroll movement smoothly absorbs whatever rotation had accumulated instead of snapping
the camera back to the base azimuth — this is distinct from (and narrower than) the drag-to-orbit
offset, which is *not* weighted by `idleWeight` and applies in every phase. `EngineStage.tsx` calls
`setHeroIdle` based on `(scene.phase.id === 'hero' || scene.t >= RETURN_TO_NORMAL_START_T) &&
!matchMedia('(prefers-reduced-motion: reduce)').matches` — the accumulator needs to be live over
both the opening idle span and the closing `RETURN_TO_NORMAL` window, since `idleWeight` blends
accumulated rotation back in over the latter too; hero idle spin and the highlight heartbeat are
the two motions disabled under reduced motion, drag is user-initiated and unaffected.

## Asset pipeline (manual, not a repo script)

The committed GLB is **not regenerated by any build step** — it was produced once from
`reports/v8-engine.zip` (an FBX + PBR texture set, not committed) via a manual pipeline recorded in
[`reports/engine-plan.md`](../../reports/engine-plan.md): `assimp export ... -fglb2` → strip the
embedded texture/material → `gltf-transform prune --keep-attributes true` (the default `prune`
silently deletes UVs — must pass this flag) → `dedup` → `meshopt` compression. Detail maps were
separately resized to 1024px and re-encoded as WebP. If the source model ever changes, redo this by
hand following that document — there is no `yarn` script wired up for it, deliberately, since it
only needs to run when the art asset itself changes, not on every build.

The studio HDRI (`studio_small_08_1k.hdr`) followed the same manual, one-off pattern: downloaded
once from Poly Haven (CC0-licensed, no attribution required) and committed directly under
`packages/website/app/assets/engine/` — there is no build step that fetches or regenerates it
either. If it's ever swapped for a different HDRI, just replace the file and re-tune
`environmentIntensity`/`environmentRotation` against screenshots (see
[Rendering](#rendering-tone-mapping-studio-hdri-and-selective-bloom)).

## How to verify a change visually

**Cloud/remote browser sessions in this environment have no WebGL support at all** — a Browser Use
cloud daemon will always render the fallback frame, which looks like success but proves nothing
about the animation. Two approaches have proven to work:

**Local headless Chromium with a software GL backend**, driven by `puppeteer-core`:

```bash
chromium --headless --no-sandbox \
  --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
```

(`executablePath: '/usr/bin/chromium'`), scrolling the dev server (`yarn dev` in
`packages/website`, served at `localhost:5173` and tunneled to `local.git-span.com`) to computed
positions.

**Connecting to an already-running remote Chrome over CDP**, if one is available on the network
(e.g. via Tailscale, `host:9222`): fetch `http://<host>:<port>/json/version` and `puppeteer.connect({
browserWSEndpoint, headers })`. Chrome's DevTools endpoint rejects requests whose `Host` header
isn't an IP or `localhost` (DNS-rebinding protection) — pass `headers: { Host: 'localhost' }`
explicitly on both the initial JSON handshake (via Node's raw `http.request`, since the global
`fetch()` forbids overriding `Host`) and the `puppeteer.connect()` call itself. This is the faster
path when a remote Chrome is already up, since there's no local Chromium/swiftshader startup cost.

Either way: the scroll-to-timeline math mirrors `timelineFromScroll` in `scene.ts` — for a target
`t` (0–100), first find the first story step's absolute top (`baseTop`), then `scrollY = baseTop -
viewportHeight + (t/100) * TIMELINE_SCROLL_VH * viewportHeight`, where `TIMELINE_SCROLL_VH` is the
exported constant from `scene.ts`. Wait for a `canvas` element (confirms `status === 'ready'`, not
the fallback) before screenshotting. Sweep the phase midpoints/boundaries from `PHASE_WEIGHTS`, and
for the color/scale/box story specifically, the `t` values from [The
timeline](#the-timeline-color-scale-and-the-bounding-box) (7.5, 16, 20, 24, 28, 41, 46, 60, 72, 83,
87, 93, 100) rather than guessing arbitrary ones. Neither harness is committed to the repo —
recreate one from this description if needed.

To sanity-check reduced motion specifically: screenshot the hero twice, a few seconds apart, once
with `page.emulateMediaFeatures([{name: 'prefers-reduced-motion', value: 'reduce'}])` and once
without — the frames should be byte-identical under the emulation and different without it (the
hero's static framing — `HERO_AZIMUTH`/`HERO_ELEVATION` — is not time-based and renders identically
either way; only the idle spin and the highlight heartbeat are disabled).

The `RETURN_TO_NORMAL` ending and the mismatch box's green-glass fix (above) were both re-verified
this way: `t` sweeps at 88.9/94.8/96.8/98.7/100 confirmed the seat-drop bug is gone and the ending
resolves to natural size/color; `t` sweeps at 47/53/60/66 confirmed the box now reads as a
translucent tinted volume rather than a near-opaque slab; a twin screenshot 5s apart at `t = 100`
confirmed the idle turntable is genuinely turning there (not a frozen frame); and a magenta-page
probe confirmed the canvas itself stays translucent (`alpha: true`) rather than compositing opaque.

## Tuning constants reference

Choreography constants in
[`beats.ts#L9-L182`](../../packages/website/app/components/marketing/story/engine/beats.ts#L9-L182):

| Constant | Value | Controls |
|---|---|---|
| `FRONT_SCALE` | 1.25 | The gear's oversized scale while its mismatch beat is active (`scaleWeightAt` cycles between 1× and this, easing back to 1× for good over `RETURN_TO_NORMAL_START_T..END_T`) |
| `MOUNT_SCALE` | 1.15 | `engineBackCover`'s scale from `MOUNT_GROW_END_T` through the rest of the mismatch story, easing back to 1× over `RETURN_TO_NORMAL_START_T..END_T` |
| `HIGHLIGHT_GREEN` / `HIGHLIGHT_RED` / `HIGHLIGHT_BLUE` / `HIGHLIGHT_ORANGE` | `#34d399` / `#ef4444` / `#3b82f6` / `#f97316` | The shared resolved color (and the bounding box's tint) / the mismatch color (shared by `ringRed`/`red`/`pistonRed`) / the gear's own first-stage transition color / the pre-highlight pulse color |
| `MARGIN_ASSEMBLED` / `MARGIN_EXPLODED` | 0.896 / 0.68 | Camera fit margin at `t = 0` (fully assembled) and the flat margin held from `CAMERA_SETTLE_T` onward — see [Camera framing](#camera-framing-atmosphere-and-the-never-cropped-constraint) for why there's no longer a `MARGIN_FAILURE` |
| `HERO_AZIMUTH` / `HERO_ELEVATION` | π / 6° | Hero's static camera angle — a level, end-on shot down the crankshaft axis (front-drive end facing camera), as the engine would present mounted in a car |
| `CANONICAL_AZIMUTH` / `CANONICAL_ELEVATION` | 35° / 18° | The three-quarter technical-drawing angle every phase from `change` onward holds; `hero`/`traverse` `lerp` into it from the hero angle |
| `AZIMUTH_DRIFT` | 18° | Total camera azimuth drift across the whole timeline (parallax while scrubbing) |
| `HERO_IDLE_RATE` | 2π/45 | Hero idle rotation: one full turn per 45s |
| `CAMERA_SETTLE_T` | 12.3 | The `t` value `heroTraverseProgress(t)` fully settles at — camera azimuth/elevation, explode, and margin all reach their canonical/exploded values here and hold flat for the remainder of `traverse` |
| `IDLE_FADE_FRACTION` | 0.3 | Fraction of the hero+traverse span (`TRAVERSE_END_T`) the idle-orbit weight fades out over, starting at `t = 0` |
| `FINAL_REASSEMBLY_START_T` / `END_T` | 83 / 87 | `t` window the whole engine collapses from exploded back to assembled over, inside `related` |
| `ORANGE_IN_START_T` / `END_T`, `ORANGE_OUT_START_T` / `END_T` | 7.5/8, 20/28 | `t` windows `preHighlightOrange` ramps in and back out over |
| `RING_BLUE_START_T` / `END_T` | 16 / 24 | `t` window the gear turns orange→blue and grows; pistons/`engineBackCover` go orange→red on the same window |
| `MISMATCH_RED_START_T` / `END_T` | 28 / 41 | `t` window the gear's own blue→red stage ramps in over |
| `COLOR_LOSS_START_T` / `END_T` | 46 / 60 | `t` window every highlight fades to no color, the gear shrinks to 1×, and the bounding box fades in |
| `RESOLVE_GREEN_START_T` / `END_T` | 60 / 72 | `t` window the bounding box fades out as every mismatch part fades up to the shared green |
| `RING_REGROW_START_T` / `END_T` | 72 / 83 | `t` window the gear regrows to `FRONT_SCALE` |
| `MOUNT_GROW_START_T` / `END_T` | derived — local `0.1`/`0.7` of `related`'s own `[start, end)` span from `TIMELINE` | `t` window `mountScaleAt` grows `engineBackCover` to `MOUNT_SCALE`, rather than a hardcoded pair of `t` values |
| `RETURN_TO_NORMAL_START_T` / `END_T` | 93 / 100 | `t` window every mismatch part's green releases, the gear/mount ease back to 1×, and `idleWeight`'s default branch ramps back to 1 — the one place the "never undone" rule (above) is deliberately broken |

Pose-synthesis, rendering, and interaction constants in
[`EngineScene.ts`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts);
the bounding-box and highlight/heartbeat constants below have moved to
[`mismatchBox.ts`](../../packages/website/app/components/marketing/story/engine/mismatchBox.ts) and
[`highlights.ts`](../../packages/website/app/components/marketing/story/engine/highlights.ts)
respectively (noted per row):

| Constant | Value | Controls |
|---|---|---|
| `EXPLODE_MIN_FRACTION` / `EXPLODE_MAX_FRACTION` | 0.54 / 1.89 | Bounds (as a fraction of `modelRadius`) the compressed exploded-pose distance is lerped into |
| `FOG_NEAR_RADIUS_FRACTION` / `FOG_FAR_RADIUS_FRACTION` | 0.4 / 0.55 | Fog near/far as fractions of the fitted bounding-sphere radius, recomputed every frame from the current camera distance |
| `DRAG_SENSITIVITY` | 0.005 rad/px | Pointer-drag orbit rate |
| `DRAG_AZIMUTH_LIMIT` | 0.9 rad | Max drag azimuth offset (offset-only, on top of the frame's base azimuth) |
| `DRAG_ELEVATION_TOTAL_LIMIT` | 1.2 rad | Max *total* elevation (`frame.elevation + offset`) — clamped against the frame's base so total elevation can't cross the pole |
| `DRAG_SNAP_BACK_RATE` | 4 (1/s) | Exponential ease-back rate for drag offsets after pointer release |
| `BOUNDING_BOX_MAX_OPACITY` / `BOUNDING_BOX_EDGE_OPACITY` (`mismatchBox.ts`) | 0.45 / 0.7 | Max fill/outline opacity of the [mismatch bounding box](#the-mismatch-bounding-box) at `boxWeight = 1` |
| `BOUNDING_BOX_PADDING` (`mismatchBox.ts`) | 1.02 | Fraction the box is padded past the mismatch parts' exact silhouette — tight, not loose |
| `BOUNDING_BOX_GLASS_GREEN` (`mismatchBox.ts`) | `#0c8a60` | Deep-emerald fill color for the box's `MeshPhysicalMaterial` — deliberately not `HIGHLIGHT_GREEN` (the mint washes to near-white at glass opacity over the cream page); the edges stay on `HIGHLIGHT_GREEN` |
| `HEARTBEAT_HZ` (`highlights.ts`) | 0.75 (~45 BPM) | Real-time rate of the [highlight heartbeat pulse](#highlight-heartbeat-and-the-blackbody-color-ramp) |
| `EMISSIVE_TIER_HIGH` / `MID` / `LOW` (`highlights.ts`) | 0.55 / 0.45 / 0.5 | Per-`HighlightKind` base emissive tier — red family / blue+finalGreen / orange |
| `EMISSIVE_SCALE` (`highlights.ts`) | 0.32 | Overall emissive magnitude multiplier — kept low enough that emissive+diffuse stays under ACES's highlight rolloff |
| `HEARTBEAT_HEAT_PEAK_MULTIPLIER` (`highlights.ts`) | 1.15 | `emissiveIntensity` multiplier at `pulseWeight === 1` |
| `HEARTBEAT_HEAT_PEAK_CAP` (`highlights.ts`) | 0.62 | Ceiling on `heat` at pulse peak, so a fully-active highlight reads hot-orange/red, never near-white |
| `BLACKBODY_WARM_HUE` (`highlights.ts`) | 30° | The shared "hotter" hue every highlight kind trends toward as `heat` rises |
| `BLACKBODY_EMBER_LIGHTNESS` (`highlights.ts`) | 0.14 | Starting (cold-ember) lightness of `blackbodyColor`'s ramp |
| `BLACKBODY_PEAK_LIGHTNESS` / `BLACKBODY_PEAK_SATURATION` (`highlights.ts`) | 0.52 / 0.92 | Lightness/saturation `blackbodyColor` reaches at `heat = HEARTBEAT_HEAT_PEAK_CAP` |
| tone mapping (`EngineScene.ts`) | `THREE.ACESFilmicToneMapping`, exposure `1.15` | Renderer-wide tone-mapping curve, replacing an earlier `AgXToneMapping`; see [Rendering](#rendering-tone-mapping-studio-hdri-and-selective-bloom) |
| `environmentIntensity` (`EngineScene.ts`) | 1.1 | Strength of the studio-HDRI-derived PMREM environment map |
| `environmentRotation` (`EngineScene.ts`) | `Euler(0, π·0.35, 0)` | Rotates the HDRI so its brightest softbox falls across the three-quarter camera angle rather than directly behind the lens |
| `BLOOM_LAYER` (`highlights.ts`) | 1 | Marker layer `updateHighlights` enables per-frame on parts with nonzero emissive, used by `darkenNonBloomed` (`EngineScene.ts`) to decide what survives the bloom-only pass |
| bloom pass params | threshold `0.45`, strength `0.35`, radius `0.92` | `UnrealBloomPass` tuning — a restrained, local accent only at pulse peak on a fully-active highlight |

`EXPLODE_OVERRIDES` (`parts.ts`) is data, not a numeric constant, but tunes the same synthesis —
see [Pose model](#pose-model-how-exploded-is-derived-read-this-before-touching-poses) for the full
per-entry rationale.

## Related pages

- [`reports/engine-plan.md`](../../reports/engine-plan.md) — the original design plan this
  implementation was built from, including the approved amendments (flat materials, sampled
  exploded poses, amber linkage, transparent canvas, bounding-sphere camera). Several of its
  specifics — the amber linkage line, the `failure`/`second`/`success` camera push-in/pull-back, the
  `FAIL_STOP` residual gap, the fake ground-contact shadow, `AgXToneMapping` — have since been
  superseded; this page (not `engine-plan.md`) is the current source of truth for the rendering and
  choreography architecture.
- [`reports/unified-homepage.md`](../../reports/unified-homepage.md) — the homepage's overall
  narrative, layout, and copy specification (predates the engine swap; its automotive-specific
  sections describe the superseded suspension metaphor, but the page architecture, prose stages,
  and terminal specification still apply).
- [`reports/engine-animation-refactor.md`](../../reports/engine-animation-refactor.md) — was
  written as a jumping-off point for a future simplification/refactoring pass; the pass it proposed
  (extracting the highlight system and bounding-box prop, adding unit coverage) has since been
  carried out (see the dated status note at the top of that report) — it now reads as a historical
  record of the pre-extraction state rather than an open proposal.
