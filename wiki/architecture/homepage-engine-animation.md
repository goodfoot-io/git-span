---
title: Homepage Engine Animation
summary: Architecture of the scroll-driven, drag-orbitable Three.js V8 engine animation on the git-span homepage — the pure-choreography/imperative-rendering split, how exploded poses are derived from a baked FBX animation that isn't an exploded view, the hero's natural in-car crankshaft-axis camera framing, the shared motion driver behind idle spin and drag snap-back, the photoreal tone-mapping/HDRI/fake-ground-shadow pass, atmospheric fog, and the rendering gotchas (including a mesh-name dedup bug) that bit past implementations.
aliases: [Engine Animation, EngineScene, Homepage 3D Animation, V8 Engine Animation, Drag to Orbit, Engine Fog]
tags: [architecture, website, threejs]
keywords: [three.js, glTF, GLB, exploded view, scroll timeline, EngineScene, beats.ts, EngineFrame, git-span metaphor, meshopt, engineBackCover, dedup suffix, drag to orbit, fog, cast iron, crankshaft-axis camera, AgX tone mapping, studio HDRI, PMREM, ground shadow]
---

The git-span homepage's pinned right-column media is a scroll-scrubbed, pointer-draggable
Three.js animation of a V8 engine, standing in as a physical metaphor for the product itself: a
resized, lifted ring gear (`gear`) fails to seat against its mating plate — the rear
`engineBackCover` — until the recorded relationship surfaces and the cover resizes to meet it. The
ring gear is the story's sole protagonist: `FRONT_DRIVE` narrows to `['gear']` alone (belt,
crankshaft/camshaft sprockets, and throttle body render as ordinary static geometry and never
resize, glow, or lift), and the gear is also the part a past silent bug (see [the dedup-suffix
trap](#trap-the-mesh-name-dedup-suffix-bug)) kept from ever resizing at all. It replaced an earlier
automotive-suspension placeholder. The full narrative
spec lives in [`reports/engine-plan.md`](../../reports/engine-plan.md) (the amended, as-built
plan) and [`reports/unified-homepage.md`](../../reports/unified-homepage.md) (the page's overall
prose and layout narrative, still suspension-themed in places — the animation section is
superseded by the engine plan).

## Where the code lives

All of it is under `packages/website/app/components/marketing/story/`:

- [`scene.ts`](../../packages/website/app/components/marketing/story/scene.ts#L24-L33) — the
  shared scroll timeline: `PHASE_WEIGHTS` (the 8 phases and their relative scroll heights),
  `deriveScene()`, and the easing/ramp helpers every other module reuses. Not engine-specific —
  also drives the left-column prose and terminal specimens.
- [`copy.ts`](../../packages/website/app/components/marketing/story/copy.ts#L69-L130) —
  `PHASE_COPY`: per-phase prose headline/body and the animation caption shown in the loading
  fallback and read by screen readers.
- [`EngineStage.tsx`](../../packages/website/app/components/marketing/story/EngineStage.tsx#L1-L99)
  — the React mount point. Client-only boot, loading/fallback UI, `aria-live` caption, and a
  `ResizeObserver`. Just two effects now: one boots `EngineScene` and tears it down, the other
  calls `setFrame`/`setHeroIdle` on every `scene` change — there is no scroll-velocity listener
  here (an earlier "scroll drop impulse" effect was removed entirely; see
  [Interaction](#interaction-drag-to-orbit)).
- `engine/beats.ts` — pure `SceneState -> EngineFrame` choreography. No `three` import.
- `engine/parts.ts` — pure mesh-name → material-family lookup, the front-drive/mount part lists,
  the dedup-suffix helper, and the explode-pose overrides. No `three` import.
- `engine/EngineScene.ts` — the **only** file that imports `three`. Loads the GLB and the studio
  HDRI, bakes poses, and does all per-frame imperative rendering, including pointer-drag orbit,
  the shared motion driver, and the photoreal tone-mapping/environment/ground-shadow pipeline (see
  [Photoreal rendering](#photoreal-rendering-tone-mapping-studio-hdri-and-the-fake-ground-shadow)).
- `packages/website/app/assets/engine/` — the committed GLB (`engine.glb`, ~1 MB, meshopt-
  compressed), three WebP detail maps (`engine-normal`, `engine-roughness`, `engine-ao`), and a
  studio-lighting HDRI (`studio_small_08_1k.hdr`, Poly Haven, CC0) used as the environment map. No
  albedo/color texture ships — see [Materials](#materials-why-there-is-no-albedo-texture).

Mounted in [`_index.tsx`](../../packages/website/app/routes/_index.tsx#L128-L134) inside the
pinned right column, and enabled for `.glb`/`.hdr` imports by
[`vite.config.ts`](../../packages/website/vite.config.ts#L22-L25)'s `assetsInclude`.

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
setHeroIdle(hero && !reduced-motion) --/         (never touches SceneState/EngineFrame)
```

`EngineFrame` (defined in
[`beats.ts#L82-L102`](../../packages/website/app/components/marketing/story/engine/beats.ts#L82-L102))
is the **entire contract** between the pure and imperative halves — one flat object of numbers,
computed fresh from `(phase, local)` with no memory of the previous call. That's what makes
scrubbing backwards through the timeline exactly as valid as scrubbing forwards: there is no
animation *state* to un-advance, only a pure function to re-evaluate. Any new behavior should be
added as a new `EngineFrame` field computed the same way — resist the temptation to give
`EngineScene` its own timeline-dependent state.

That said, `EngineScene` **does** own transient, non-choreography state: the hero idle spin offset
and the drag-to-orbit offsets. Both are deliberately kept out of `EngineFrame` — they're
camera/pose *modifiers* layered on top of whatever `beats.ts` computes, never fed back into it, and
never persisted across a `setFrame` call in a way that would make scrubbing order-dependent. See
[Interaction](#interaction-drag-to-orbit). (An earlier third piece of transient state, a decaying
scroll-drop impulse driven by a `window` scroll-velocity listener, was removed outright — see that
section.)

`EngineStage.tsx` wires this together with exactly two effects: one boots `EngineScene` via
dynamic `import('./engine/EngineScene')` (three.js never loads during SSR or blocks the initial
bundle) and tears it down on unmount, and the other calls `engine.setFrame(engineFrame(scene))` and
`engine.setHeroIdle(...)` on every `scene` change once loaded. A load or WebGL failure sets
`status: 'fallback'`, which renders the quiet `#f2efe6` frame with the phase caption instead of a
canvas.

## The eight phases

`PhaseId` (from `scene.ts`) is `'hero' | 'traverse' | 'change' | 'failure' | 'second' | 'span' |
'related' | 'success'`. Each has a dedicated `*At(phase, ...)` function in
[`beats.ts#L104-L377`](../../packages/website/app/components/marketing/story/engine/beats.ts#L104-L377)
— most take `local` (`l`), several now take the raw timeline `t` instead (or both), one per
`EngineFrame` field, assembled by
[`engineFrame()`](../../packages/website/app/components/marketing/story/engine/beats.ts#L379-L402).

Phase boundaries (`t`, from `TIMELINE` in `scene.ts`): `hero` 0–6.06, `traverse` 6.06–18.18,
`change` 18.18–36.36, `failure` 36.36–54.55, `second` 54.55–66.67, `span` 66.67–78.79, `related`
78.79–96.97, `success` 96.97–100.

| Phase | What happens physically |
|---|---|
| `hero` | The engine sits assembled, viewed end-on down its crankshaft axis as it would present mounted in a car (`HERO_AZIMUTH = π`, `HERO_ELEVATION = 6°`), slowly idle-orbiting; the instant scrolling begins (`t` above 0, still inside `hero`) explosion, the camera's pull-back to the canonical angle, and the margin's tightening all start ramping on one shared curve, `heroTraverseProgress(t)` |
| `traverse` | Continues the same `heroTraverseProgress(t)` curve `hero` started — explode, azimuth/elevation, and margin all reach their canonical/fully-exploded values and hold flat at `CAMERA_SETTLE_T` (`t = 12.3`), well before `traverse` itself ends (`t = 18.18`), so the framing is rock-stable while traverse's prose is on screen; the idle orbit has already faded out over a short leading fraction of the span; the gear and `engineBackCover` briefly pulse orange (`preHighlightOrange`, `t` ≈ 7.5–19) as the camera settles, foreshadowing which parts the story is about |
| `change` | The ring gear (`FRONT_DRIVE`'s sole member) grows to `FRONT_SCALE` and lifts off its seat (`frontDriveLift` ramping to 1) between `t = 24` and `t = 28`; in the same `t` ≈ 23.5–29 window the gear pulses green while `engineBackCover` pulses red in sympathy — a deliberate foreshadow of the mismatch `failure` reveals, timed just ahead of the visible resize/lift |
| `failure` | Camera pushes in (eased over the phase's first 15%, not a snap); reassembly stalls at `FAIL_STOP` — a visible gap where the oversized, lifted gear can't seat; `engineBackCover`, the ring gear's rear mating plate, flags red |
| `second` | Camera pulls back out (same eased first-15% shape); re-explode from the stalled gap back to the full exploded view; red fades |
| `span` | An amber linkage line draws from the gear to `engineBackCover`; the mount begins glowing green |
| `related` | `engineBackCover` resizes to `MOUNT_SCALE`; amber and the "just resizing" green fade as geometry resolves |
| `success` | Camera pushes in (eased first-15% shape again); the gear's target remaps onto the resized mount (`seatAdjust`, `gear`-only — see [Pose model](#pose-model-how-exploded-is-derived-read-this-before-touching-poses)) and the mount rises (`frontDriveLift * seatAdjust`) to meet the gear's lift as everything seats cleanly |

The `failure`/`second`/`success` camera push-in/pull-back eases (`MARGIN_PUSH_FRACTION`, 0.15 of
each phase's own local range) are covered in [Camera
framing](#camera-framing-atmosphere-and-the-never-cropped-constraint).

Each `*At` function is a plain `switch` over `PhaseId` with no `default` fallthrough between cases
that should hold a value — **a value not respecified for a later phase holds at its previous
phase's end value** (e.g. `frontDriveScaleAt` returns `FRONT_SCALE` for every phase from `change`
onward, including `success` — the resize is permanent, not undone by the story). When adding a new
phase or field, decide explicitly whether it should hold, reset, or animate, and write every case —
a missing `case` is a TypeScript exhaustiveness error by design (no `default` on the phase-keyed
switches). `frontDriveLiftAt`
([`beats.ts#L175-L189`](../../packages/website/app/components/marketing/story/engine/beats.ts#L175-L189))
is a recent example: it deliberately mirrors `frontDriveScaleAt`'s ramp shape and spells out every
phase from `change` onward as `1` rather than falling through, even though the value never changes
again — see the code comment.

## Pose model: how "exploded" is derived (read this before touching poses)

This is the least obvious part of the system and the one most likely to break silently if touched
without context.

The source model ships one baked animation clip in the GLB (assimp's `"Take 001"`, ~984 channels).
It is **not** an authored exploded-view constellation — verification during the build found it to
be a **sequential one-part-at-a-time fly-in**: at frame 0, parts are parked in arbitrary off-stage
staging positions (not a clean "pulled back along its axis" pose), and they fly in to their
assembled seat one after another as the clip plays. Naively sampling frame 0 as "exploded" and the
last frame as "assembled" renders a scattered speck cloud, not an engine.

[`EngineScene.load()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L224-L450)
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
   compressed by `rawDistance / (rawDistance + modelRadius)` into `[EXPLODE_MIN_FRACTION,
   EXPLODE_MAX_FRACTION]` (currently 0.54–1.89 of the model's bounding radius — the product of two
   tuning passes: first tripled from an original 0.30–1.05 for a wider, more camera-friendly
   constellation, then reduced by roughly 40% in a follow-up pass that tightened the exploded-view
   zoom). A part listed in `EXPLODE_OVERRIDES` adjusts this: `direction: 'reference'` substitutes
   `healthyDirection` for the part's own axis, and `minDistanceFraction`/`maxDistanceFraction`
   floor/cap the distance as a fraction of the model radius — see `parts.ts`'s `EXPLODE_OVERRIDES`
   and `EXPLODE_DIRECTION_REFERENCE`. Twelve entries exist. `gear` (`direction: 'reference'`, floor
   0.9 — its own baked displacement is too small and not reliably outward) and `engineBackCover`
   (`direction: 'own'`, cap 0.63) are the original pair. Both override fractions have been scaled by
   the same running factor as `EXPLODE_MIN_FRACTION`/`EXPLODE_MAX_FRACTION` across both tuning
   passes (net ×1.8 of their original 0.5/0.35), which is what preserves the cover's cap's
   **ordering invariant**: assembled, the gear sits outboard of the cover it seats against (Z ≈ 72
   vs 66), but the cover's huge raw fly-in distance (348 units) saturates it near
   `EXPLODE_MAX_FRACTION` while the gear only reaches its floor — uncapped, the cover's exploded
   seat would overtake the gear's, an impossible pass-through that showed as visible clipping while
   the two crossed mid-transition (worst during `second`, where the cover re-explodes its full
   travel from zero but the gear only its post-stall half). Capping the cover and flooring the gear
   by the same factor keeps gear-outside ordering at every blend weight of both curves — scaling one
   without the other would break it. `engineBlockCylinderLeft`/`Right` (`direction: 'own'`, cap
   1.0) are the newer pair, added to fix an analogous clipping bug one bank down: each cylinder
   bank's block casting sits directly beneath its cylinder head (assembled Y ≈ 12.4 vs 26.5), but
   the block's raw staging→assembled distance (~180–200 units) is much larger than the head's
   (~120) and its raw direction leans further sideways — uncapped, the general per-part compression
   sends the block *past* the head along that diverging axis, so partway through the explode/
   re-explode ramp the darker `castIronDark` block overtakes the lighter aluminum head's
   silhouette. Capping the block's own-axis distance below the head's own ~1.3×`modelRadius` keeps
   the head clearly outboard of its block at every explode weight, the same technique used for
   gear/`engineBackCover` above. The remaining eight entries, `piston001`–`piston008`
   (`direction: 'own'`, cap 0.5), fix the last instance of the same family of bug: the piston
   bodies' baked fly-in distances are anomalously large (270–704 units, versus ~120–200 for their
   neighbors — the same "unreliable baked fly-in" trap documented for `gear`, manifesting as an
   outsized distance rather than a bad direction), which parked every bank's pistons at nearly the
   same exploded point *inside* its cylinder head. Capping their own-axis travel at half the model
   radius clears both the block below and the head above with comfortable margin. Orientation and
   scale are held at their assembled values; a
   technical exploded view translates parts, it doesn't tumble them.

A part whose track never actually moves it (assembled ≈ staging) falls back to exploding radially
away from the model centroid instead of a zero-length axis.

### Trap: the mesh-name dedup-suffix bug

`GLTFLoader` renames a mesh whenever it shares a name with its own wrapper node in the source FBX
— the *second* claimant of a name gets suffixed (`gear` → `gear_1`, `belt` → `belt_1`,
`crankshaftSprocket` → `crankshaftSprocket_1`, `camshaftSprocket` → `camshaftSprocket_1`). An
earlier version of this code matched `FRONT_DRIVE`/`FRONT_MOUNT` membership against the live mesh
name with an exact-match `Set`, which silently missed 4 of the 5 `FRONT_DRIVE` parts — only
`throttleBody` and the (now-retired) `engineBlockFront` mount ever matched. That's why the gear
never resized or glowed, and why reassembly visually "melted through its mount" instead of
stopping short at a visible gap: most of the front-drive parts were never being treated as
front-drive at all.

The fix is [`stripDedupSuffix()`](../../packages/website/app/components/marketing/story/engine/parts.ts#L92-L94)
— every membership check in this system (`FRONT_DRIVE`, `FRONT_MOUNT`, `FRONT_DRIVE_SEAT_ADJUST`,
`EXPLODE_OVERRIDES`, `EXPLODE_DIRECTION_REFERENCE`) strips a trailing `_<n>` before comparing. If a
future re-export changes which meshes collide with wrapper-node names, a part can silently drop
back out of these lists in exactly this way — if a part stops resizing/highlighting/glowing, check
whether its live mesh name carries a dedup suffix before assuming the list itself is wrong.

After baking, the imported `gltf.scene` (and its `$AssimpFbx$` pivot chains, an assimp FBX import
artifact) is discarded. Every part becomes a fresh flat-hierarchy `THREE.Mesh` sharing the original
geometry, parented directly under one `THREE.Group` — there is no scene graph depth to reason about
at render time, just a flat `PartRecord[]`
([`EngineScene.ts#L42-L53`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L42-L53)),
which also carries each part's `isFrontDrive`/`isMount`/`isSeatAdjust` flags precomputed at load
time.

## Materials: why there is no albedo texture

The source FBX's baked albedo photo-texture paints the cylinder-head covers bright red with a
visible "V8" logo — both unacceptable, since red is reserved for the failure/mismatch highlight and
a baked logo shouldn't ship. The runtime assigns materials by **part family** instead:
[`parts.ts`](../../packages/website/app/components/marketing/story/engine/parts.ts#L1-L54) maps
every mesh name to one of nine families (`castIronDark`, `castIron`, `castIronLight`,
`frontCover`, `rotating`, `aluminum`, `polymer`, `rubber`, `hardware`) via longest-prefix,
case-insensitive matching, and
[`FAMILY_MATERIAL`](../../packages/website/app/components/marketing/story/engine/parts.ts#L71-L84)
gives each a flat color/roughness/metalness. The former single `structure` family is now split
three ways so the engine's mass reads as assembled castings rather than one flat surface:
`castIronDark` for the oil pan (`#3f4247`, roughness 0.65/metalness 0.8, the darkest — a sand-cast
part), `castIron` for the block, `engineBackCover`, and the unmatched-name fallback (`#4a4d52`,
0.6/0.85), and `castIronLight` for the side covers (`#54575d`, 0.55/0.85). `frontCover` is
unchanged. All families still share the GLB's normal, roughness, and AO detail maps (loaded in
[`EngineScene.load()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L290-L304)
and wired into each family's material in
[`materialFor()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L449-L464))
for surface realism — only the color layer is synthetic. The environment map from the studio HDRI
(see [Photoreal
rendering](#photoreal-rendering-tone-mapping-studio-hdri-and-the-fake-ground-shadow)) is what most
recently changed how these families actually read on screen, but the family/color assignment itself
is unaffected.

The source naming has real inconsistencies that `familyOf` must tolerate:
`cylinderHeadCoverleft` (lowercase `l`) vs `cylinderHeadCoverRight`, and `intakeManifoldleft` vs
`intakeManifoldRight`. Matching is case-insensitive and prefix-based specifically to survive this.
If a future GLB re-export changes a mesh name, `familyOf`'s fallback (`hardware` for anything
containing "bolt"/"nut", `castIron` otherwise) prevents a silent crash but will look wrong — check
the mesh-name list in
[`parts.ts`](../../packages/website/app/components/marketing/story/engine/parts.ts) against the new
export.

`FRONT_DRIVE` and `FRONT_MOUNT`
([`parts.ts#L96-L117`](../../packages/website/app/components/marketing/story/engine/parts.ts#L96-L117))
are the two lists that drive the whole failure/success narrative. `FRONT_DRIVE` used to hold all
five front-accessory-drive parts (`belt`, `crankshaftSprocket`, `camshaftSprocket`, `gear`,
`throttleBody`); a story re-scope narrowed it to `['gear']` alone, so belt/sprockets/throttleBody
now render as ordinary static geometry and never highlight, resize, or lift — only the ring gear
does. `EngineScene` derives `frontDriveParts`, the highlight-shell count, and the linkage-line
count from this list's length, so the narrowing automatically collapsed those from five to one
each. The mesh names are matched post [`stripDedupSuffix`](#trap-the-mesh-name-dedup-suffix-bug).
`FRONT_MOUNT` (`['engineBackCover']`) is the mesh that receives the highlight and resize on the
other side, unaffected by the re-scope. `FRONT_MOUNT` was moved here from `engineBlockFront` — see
[Highlights and linkage](#highlights-and-linkage) for why. Changing which physical parts tell the
story is a one-line edit here, not in `EngineScene.ts` or `beats.ts`.

## Photoreal rendering: tone mapping, studio HDRI, and the fake ground shadow

A later pass reworked the renderer's overall look — tone mapping, environment lighting, and a fake
contact shadow — without touching the flat-material-by-family system above.

**Tone mapping.** The constructor now sets
[`this.renderer.toneMapping = THREE.AgXToneMapping`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L243-L256)
with `toneMappingExposure = 1.15`, replacing an earlier `ACESFilmicToneMapping`. The choice was
A/B'd against screenshots at `t = 0` (hero, gray metal end-on) and `t = 48` (failure, red highlight
legibility): AgX reads with more filmic contrast on the unlit gray-metal families (`castIron`/
`aluminum`) without crushing shadow detail on the machined faces, where `NeutralToneMapping` looked
flatter and washed out on the same frames. The exposure is nudged slightly above AgX's own default
to keep the cream page composition light and airy rather than moody, since AgX's contrast curve
darkens midtones a touch on its own.

**Studio HDRI environment.** An earlier procedural `RoomEnvironment` is replaced by a real
equirectangular HDRI —
[`studio_small_08_1k.hdr`](../../packages/website/app/assets/engine/) (Poly Haven, CC0), loaded via
`RGBELoader` and converted through `THREE.PMREMGenerator` into a PMREM environment map
([`EngineScene.load()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L284-L320)).
This gives real softbox/rim gradients across the machined faces (ring gear, cylinder-head covers)
instead of a flat ambient wash. `scene.environmentIntensity` is `1.1` and
`scene.environmentRotation` is `new THREE.Euler(0, Math.PI * 0.35, 0)` — both tuned against
screenshots at `t = 0` (hero, end-on) and `t = 12` (exploded): intensity high enough that the
softbox gradient reads on the aluminum/cast-iron faces without blowing out the light parts under
AgX, rotation chosen so the HDRI's brightest softbox falls across the three-quarter camera angle
rather than directly behind the lens. `scene.background` stays `null` throughout — the canvas is
still transparent (`alpha: true`) over the cream page background, and the environment map must
never paint over it. `vite.config.ts`'s `assetsInclude` was extended to `**/*.hdr` alongside
`**/*.glb` so the HDRI loads as a static asset the same way the GLB does.

**Fake ground-contact shadow.** The scene has no shadow-casting light rig, so a real shadow map
isn't an option; instead, a flat unlit radial-gradient plane stands in for one. It's built once at
load time from the *assembled* (rest-pose) bounding box —
[`buildGroundShadowTexture()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L824-L842)
generates a soft dark-center-to-transparent-edge canvas texture, and
[`buildGroundShadow(box)`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L849-L873)
sizes a horizontal plane to `GROUND_SHADOW_FOOTPRINT_SCALE` (1.6×) the assembled footprint and
positions it `GROUND_SHADOW_DROP_FRACTION` (0.08, a fraction of `modelRadius`) below the oil pan —
a deliberate, visible gap, so the engine reads as hovering just above the ground rather than resting
flush on it. Because it's sized from the *assembled* box once at load time (not recomputed from
live per-frame bounds), it never jitters or resizes as parts explode — it's a fixed prop pinned to
the resting pose. Its opacity is driven every frame by
[`updateGroundShadow()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L981-L987)
from `EngineFrame.groundShadow`, a pure function
([`groundShadowAt()`](../../packages/website/app/components/marketing/story/engine/beats.ts#L375-L377))
that deliberately reuses `explodeAt`'s exhaustive phase switch instead of duplicating a parallel one:
`groundShadow = 1 - explode` for every phase — 1 (fully visible) at the top of `hero`, fading to 0 as
`heroTraverseProgress(t)` runs, 0 (hidden) held flat through `change`/`second`/`span`/`related` (all
fully exploded), and partial values in `failure`/`success` as the body reassembles. Like the
highlight shells and linkage, its material sets `fog: false` (unlit story UI, not physical scene
geometry) and `renderOrder = -1` so it draws before the opaque parts and never fights the oil pan's
depth.

## The mismatch lift: `frontDriveLift`

A second degree of freedom layers on top of the gear's resize: `EngineFrame.frontDriveLift`
(0..1, defined in
[`beats.ts#L88-L91`](../../packages/website/app/components/marketing/story/engine/beats.ts#L88-L91))
is a pure weight computed by
[`frontDriveLiftAt()`](../../packages/website/app/components/marketing/story/engine/beats.ts#L175-L189) —
the same ramp shape as `frontDriveScaleAt`
([`beats.ts#L152-L168`](../../packages/website/app/components/marketing/story/engine/beats.ts#L152-L168)):
0 through `hero`/`traverse`, ramping to 1 over `change` between `CHANGE_RESIZE_START_T` (`t = 24`)
and `CHANGE_RESIZE_END_T` (`t = 28`), held at 1 permanently from there onward, including through
`success`. Both functions were retimed off `change`'s local `[0.15, 0.75]` window onto these
absolute `t` values so the resize/lift ramp lands in the same window as the green/red highlight
pulse below it (`GLOW_IN_START_T`..`GLOW_OUT_END_T`, `t` ≈ 23.5–29) rather than drifting relative to
it as `change`'s own scroll-height tuning changes. It's a separate `EngineFrame` field rather than
reusing `frontDriveScale` directly so `EngineScene` can resolve it into world units independently of
the scale factor's own numeric range.

`EngineScene`'s
[`updatePartTransforms()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L604-L665)
resolves the weight: `FRONT_LIFT_FRACTION` (0.18) of the gear's own bounding-sphere radius, applied
along `FRONT_LIFT_AXIS` (world `+Y`, the space every part's assembled/exploded position is already
expressed in — so it reads as "up off the cover's face" consistently in every phase that shows it;
`hero`/early-`traverse` never show it since `frontDriveLift` is still 0 there). The gear gets the
full lift; the mount (`engineBackCover`) gets `liftAmount *
frame.seatAdjust`, so the mount only rises to meet the gear once `seatAdjust` engages in `success`
— the gap the lift opens in `change` stays visibly open through `span`/`related` and closes cleanly
only at the end of `success`, in lockstep with the gear's seat-target remap (see [Pose
model](#pose-model-how-exploded-is-derived-read-this-before-touching-poses)). Like the resize
itself, the lift is a modification the story never undoes once introduced.

## Highlights and linkage

Highlight shells are geometry clones sitting just outside their part, built in
[`buildHighlightShells()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L667-L725).
There are now five `ShellRecord` kinds, not three: `'green'` and the new `'orange'` on each
front-drive part (currently just `gear`, scaled 1.02×/1.03×), and `'red'`, `'mountGreen'`, and the
new `'coverOrange'` on the mount part (`engineBackCover`, scaled 1.04×/1.04×/1.05×). The `orange`/
`coverOrange` pair is the pre-highlight pulse (`frame.preHighlightOrange`, ~`t` 7.5–19) — one shared
`EngineFrame` weight driving two separate shell instances, one per part, distinct in color
(`HIGHLIGHT_ORANGE`, `#f97316`) from both the amber linkage color and the later green/red beat so it
reads as a distinct foreshadowing cue rather than an early linkage or mismatch signal. All five
kinds are ordinary depth-tested overlays — the mount's shells (scaled slightly larger than the
front-drive shells for clearance, since `engineBackCover` is a thin flat plate seen edge-on from
some camera angles) need no `depthTest: false` "x-ray" treatment, same as before.

This is a change from an earlier version of the system: `FRONT_MOUNT` used to be
`engineBlockFront`, a same-shaped plate buried inside the assembled engine at the *opposite*,
front-drive end, with no unobstructed camera angle — its highlight shells needed `depthTest: false`
with a high `renderOrder` (an "x-ray" material) purely to be visible at all at the beats
(`failure`/`span`/`related`) where it needs to flag red or green. `FRONT_MOUNT` now points at
`engineBackCover`, a large flat `castIron` plate at the crank's rear end (assembled Z ≈ +65.6,
immediately adjacent to `gear` at Z ≈ +72.3) that *is* externally visible from the canonical camera
angles, so the x-ray hack for the mount was removed. That premise — "the mount is buried and needs
depthTest:false to read" — is now historical; it no longer describes any code in this file.

Weights are resolved per shell kind in
[`updateHighlights()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L805-L821):
`green` reads `frame.green`, `red` reads `frame.red`, `mountGreen` reads `frame.mountGreen`, and
both `orange`/`coverOrange` read the same `frame.preHighlightOrange`. `frame.red` itself now covers
two distinct beats from one field: the `change`-phase sympathy pulse on `engineBackCover` (`t` ≈
23.5–29, sharing `greenAt`'s exact ramp so gear-green and cover-red read as one synchronized beat)
and the original `failure`/`second` mismatch flag — see [The eight phases](#the-eight-phases) and
[`redAt()`](../../packages/website/app/components/marketing/story/engine/beats.ts#L231-L248).

The **amber linkage** cylinders (built in
[`buildLinkageLines()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L783-L803))
still use `depthTest: false` with a high `renderOrder` — unlike the mount shell, a linkage line runs
from a still-separated front-drive part all the way across the assembly to the mount, and would be
partially or fully occluded by intervening parts along that path at exactly the beats where it
needs to read clearly. If a future highlight or overlay needs the x-ray treatment, this is the
remaining example of it in the codebase.

The linkage itself is drawn as thin unlit cylinder meshes (`CylinderGeometry`, radius ≈
`modelRadius * 0.008`), not `THREE.Line` — `LineBasicMaterial` renders at a fixed one device-pixel
width regardless of scene scale, which is invisible against the pale page background at the size
this animation renders. If a future addition needs another kind of line-like overlay, reuse the
cylinder-mesh approach, not `THREE.Line`. Both the highlight shells and the linkage material set
`fog: false` — they're unlit story UI, not part of the physical scene, and must not veil with
[fog](#camera-framing-atmosphere-and-the-never-cropped-constraint). The fake ground-shadow plane
(see [Photoreal
rendering](#photoreal-rendering-tone-mapping-studio-hdri-and-the-fake-ground-shadow)) sets `fog:
false` for the same reason.

## Camera framing, atmosphere, and the never-cropped constraint

The page's framing rule is that the engine must never touch the media frame's edges, at any beat,
including fully exploded (when the model's footprint is largest). This is solved mathematically
rather than by hand-tuning per-beat camera shots:
[`fitCameraToFrame()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L989-L1027)
computes the union bounding sphere of every part's current world position each frame
(`sphereUnion`, a standard two-sphere merge,
[`EngineScene.ts#L131-L147`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L181-L197)),
then places the camera at the distance that fits that sphere plus a margin, accounting for aspect
ratio via `fitFov = min(fovY/2, atan(tan(fovY/2) * aspect))`. `frame.margin` is the one per-beat
tuning knob; everything else in the shot is derived, not staged.
[`marginAt()`](../../packages/website/app/components/marketing/story/engine/beats.ts#L341-L364) is
no longer a plain per-phase switch for `hero`/`traverse`: it `lerp`s continuously from
`MARGIN_ASSEMBLED` (1.12) to `MARGIN_EXPLODED` (0.85) over `heroTraverseProgress(t)` — the same
shared curve driving explode and the azimuth/elevation approach — so the camera pull-back starts at
the first pixel of scroll and reaches the exploded margin by `CAMERA_SETTLE_T` (`t = 12.3`), holding
flat for the remainder of `traverse`, with no snap anywhere in `hero`/`traverse`. `MARGIN_ASSEMBLED`
therefore only fully applies at `t = 0`. `MARGIN_EXPLODED` also covers `change`, `span`, and
`related` outright, and sits below 1.0 deliberately: the bounding sphere over-estimates the exploded
constellation's actual silhouette (parts explode along specific directions, not isotropically,
leaving empty corners no geometry ever reaches), so a sub-1.0 margin is needed to still land the
visible cluster close to the frame edge. `MARGIN_FAILURE` (1.06) is the tighter margin for `failure`
and `success` (the auto push-in beats).

`marginAt` no longer snaps instantly to a new flat value at the `change → failure`, `failure →
second`, and `related → success` phase boundaries — it eases over `MARGIN_PUSH_FRACTION` (0.15) of
each of those phases' own local range instead. This is a bug fix: the bounding-sphere radius the
camera distance is fit to is already continuous across every one of these seams, so an
instantaneous margin step used to read as an instantaneous camera-distance pop — a "sudden resize"
with nothing else in the frame explaining it, reported at `t` ≈ 36.3 and ≈ 54.6, right on top of the
actual `change → failure` (`t = 36.36`) and `failure → second` (`t = 54.55`) boundaries. `failure`
now eases in from `MARGIN_EXPLODED` to `MARGIN_FAILURE` over its first 15% ("the camera zooms in"),
`second` eases back from `MARGIN_FAILURE` to `MARGIN_EXPLODED` over its first 15% ("the camera zooms
out"), and `success` eases from `MARGIN_EXPLODED` to `MARGIN_FAILURE` the same way for consistency
(not one of the two originally-reported pops, but the identical root cause, so fixed alongside them
rather than left as a matching latent glitch). If a future part addition makes the model's
silhouette asymmetric in a way the bounding sphere under-serves, adjust the margin constants before
reaching for a bespoke camera path — and iterate against real screenshots, not the numbers in
isolation.

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
FOG_FAR_RADIUS_FRACTION` (0.55) — both densified from an earlier 0.3/1.6 pass so the fog reads more
strongly: the far bound now sits much closer to the fitted distance instead of well past the whole
bounding sphere, so the fully exploded view's rearmost parts clearly veil toward the page background
rather than staying crisp. Because both fractions track the continuously-changing bounding sphere,
the assembled view (small radius, camera close, parts close together) still only lightly hazes,
while the fully exploded view (large radius, camera far) is where the veiling reads strongest.
Highlight shells and the linkage material opt out (`fog: false`) since they're unlit UI, not scene
geometry.

## Interaction: drag-to-orbit

A deliberately transient input path sits alongside the scroll-driven choreography, handled
entirely inside `EngineScene` and never fed back into `SceneState`/`EngineFrame`. (An earlier
"scroll drop impulse" — a `window` scroll-velocity listener that sagged the whole part group and
decayed back to rest — was removed outright as part of the photoreal/retiming pass; there is no
remaining mention of it anywhere in the current source. If you're looking for it in an old
screenshot or report, it no longer exists.)

**Drag-to-orbit** (all phases). Pointer events on the canvas
([`EngineScene.ts#L507-L556`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L604-L653)) —
`setPointerCapture` on down, `touch-action: pan-y` and `grab`/`grabbing` cursor styling set on the
canvas element in the constructor — accumulate clamped azimuth/elevation offsets
(`DRAG_SENSITIVITY`, `DRAG_AZIMUTH_LIMIT`, `DRAG_ELEVATION_TOTAL_LIMIT`) from pointer movement. The
signs are inverted from the raw pointer delta so the interaction reads as grabbing the object
itself rather than panning a camera around it: azimuth offset *subtracts* `dx * DRAG_SENSITIVITY`
(dragging left rotates the engine clockwise), and the elevation sign is likewise flipped (dragging
up looks up more). These offsets are blended into `fitCameraToFrame` **unconditionally** — not
gated by `idleWeight` the way the hero idle spin is — so dragging works identically in every phase,
not just the hero. On release, they ease back to zero at `DRAG_SNAP_BACK_RATE`.

### The shared motion driver

Idle spin and drag snap-back are both genuinely time-based (not purely scroll-driven) motions, and
they used to risk two competing `requestAnimationFrame` loops (a third, the scroll-impulse decay,
existed before that motion was removed entirely — see above). They share one:
`ensureMotionLoop()`/`motionTick()`
([`EngineScene.ts#L557-L602`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L557-L602)).
Either starting (hero idle turning on, or a drag ending) calls `ensureMotionLoop()`, which starts
the loop if it isn't already running. Each tick advances both (accumulating idle rotation if
`heroIdle`, easing drag offsets toward zero if not dragging), calls `applyFrame` again, and the loop
stops itself once both are settled (`heroIdle` off and both drag offsets at exactly zero) rather
than running forever or requiring an external stop signal. The idle accumulator itself is also
wrapped here: once `idleAzimuthOffset` accumulates past ±π it's normalized back into `(-π, π]`, but
**only** while `frame.idleWeight === 1` (still in `hero`, or at `l = 0` of `traverse`) — a raw 2π
jump is invisible to the blended camera azimuth only at full weight, since ±π are 2π-equivalent
camera positions there; wrapping mid-fade would show as a visible snap. The practical effect is
that `traverse`'s idle fade-out only ever has to unwind at most half a turn of accumulated spin,
not however many full turns built up over a long hero hold.

## Hero: the in-car pose and idle rotation

An earlier version of the hero stood the engine on end as a vertical column, reoriented by a
dedicated `computeUprightQuaternion()` that measured the crankshaft's own baked axis and rotated
every part's transform about the model's center each frame. That machinery — the quaternion
function, the `uprightWeight`/`uprightWeightAt` field and blend, and the `centerOffset`-pivoted
rotation step in `updatePartTransforms()` — has been deleted outright. The hero now shows the
engine in its natural, baked-in-the-model orientation (no per-part reorientation at all) and
achieves the "looking down the crankshaft" read purely with the *camera*: `HERO_AZIMUTH = π` and
`HERO_ELEVATION = 6°` (a touch above dead level) place the camera on the model's −Z side looking
toward +Z, the front-drive end — a level, end-on shot down the crank axis, as the engine would
present mounted in a car — instead of `CANONICAL_AZIMUTH`/`CANONICAL_ELEVATION` (35°/18°, the
three-quarter technical-drawing angle every later phase holds).

**The hero → traverse camera move.** `azimuthBaseAt`/`elevationAt`
([`beats.ts#L289-L307`](../../packages/website/app/components/marketing/story/engine/beats.ts#L251-L269))
`lerp` from the hero angle to the canonical angle across `hero` and `traverse` together, riding
`heroTraverseProgress(t)`
([`beats.ts#L73-L75`](../../packages/website/app/components/marketing/story/engine/beats.ts#L82-L84)) —
one continuous, monotonic curve spanning from the top of `hero` (`t = 0`, fully assembled, hero
angle) to `CAMERA_SETTLE_T` (`t = 12.3`, fully exploded, canonical angle), where it now settles and
holds flat, rather than the actual end of `traverse` (`t = 18.18`) it used to ride all the way to.
The retime keeps the framing rock-stable while `traverse`'s prose ("Your code is full of
relationships it can't express.") is on screen, instead of the camera still visibly rotating/pulling
back well after that copy appears. `explodeAt`, `frontDriveExplodeAt`, and `marginAt` all ride the
same curve for their own hero/traverse blends (see [Camera
framing](#camera-framing-atmosphere-and-the-never-cropped-constraint) and [The eight
phases](#the-eight-phases)) — sharing one curve instead of gluing separate hero and traverse curves
at the phase boundary is what guarantees the motion has no seam exactly where `hero` hands off to
`traverse`, and what makes it start at the very first pixel of scroll rather than waiting for
`traverse` to begin. `CAMERA_SETTLE_T` is deliberately distinct from `TRAVERSE_END_T` (`traverse`'s
actual phase-boundary end, ~18.18): `idleWeightAt` (below) still fades against `TRAVERSE_END_T`, not
`CAMERA_SETTLE_T` — the two settle timings serve different purposes and were not meant to move
together.

**Idle rotation.** The hero's idle spin itself is unchanged in mechanism: a
`requestAnimationFrame`-driven `idleAzimuthOffset` (ticked by the shared motion driver) accumulates
at `HERO_IDLE_RATE` (one turn per 45s) while `setHeroIdle(true)`. `EngineFrame.idleWeight`
([`idleWeightAt`](../../packages/website/app/components/marketing/story/engine/beats.ts#L275-L283),
1 throughout `hero`, fading to 0 over `IDLE_FADE_FRACTION` (0.3) of the hero+traverse span
(`TRAVERSE_END_T`) — starting at the first pixel of scroll, not at the top of `traverse`) blends
that accumulated offset into the camera azimuth
([`fitCameraToFrame()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L878))
so the first scroll movement smoothly absorbs whatever rotation had accumulated instead of snapping
the camera back to the base azimuth — this is distinct from (and narrower than) the drag-to-orbit
offset, which is *not* weighted by `idleWeight` and applies in every phase. `EngineStage.tsx` calls
`setHeroIdle` based on `scene.phase.id === 'hero' && !matchMedia('(prefers-reduced-motion:
reduce)').matches` — this is the only motion disabled under reduced motion; drag is user-initiated
and unaffected.

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
`environmentIntensity`/`environmentRotation` against screenshots (see [Photoreal
rendering](#photoreal-rendering-tone-mapping-studio-hdri-and-the-fake-ground-shadow)).

## How to verify a change visually

**Cloud/remote browser sessions in this environment have no WebGL support at all** — a Browser Use
cloud daemon will always render the fallback frame, which looks like success but proves nothing
about the animation. Visual verification requires a local headless Chromium with a software GL
backend:

```bash
chromium --headless --no-sandbox \
  --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
```

driven by `puppeteer-core` (`executablePath: '/usr/bin/chromium'`), scrolling the dev server (`yarn
dev` in `packages/website`, served at `localhost:5173` and tunneled to `local.git-span.com`) to
computed positions. The scroll-to-timeline math mirrors `timelineFromScroll` in `scene.ts`: for a
target `t` (0–100), first find the first story step's absolute top (`baseTop`), then `scrollY =
baseTop - viewportHeight + (t/100) * TIMELINE_SCROLL_VH * viewportHeight`, where
`TIMELINE_SCROLL_VH` is the exported constant from `scene.ts`. Wait for a `canvas` element (confirms
`status === 'ready'`, not the fallback) before screenshotting. This harness was written ad hoc
during development and was not committed to the repo — recreate it from this description if
needed, or check `reports/engine-plan.md`'s validation section for the beat-by-beat `t` values used
during the last review pass. A working example of this pattern is a small Node script (e.g.
`beat-sweep.mjs`) that launches Chromium with the flags above, computes `scrollY` for a list of `t`
values the same way, and screenshots each — sweep the phase midpoints/boundaries from
`PHASE_WEIGHTS` rather than guessing arbitrary `t`s.

To sanity-check reduced motion specifically: screenshot the hero twice, a few seconds apart, once
with `page.emulateMediaFeatures([{name: 'prefers-reduced-motion', value: 'reduce'}])` and once
without — the frames should be byte-identical under the emulation and different without it (the
hero's static framing — `HERO_AZIMUTH`/`HERO_ELEVATION` — is not time-based and renders identically
either way; only the idle spin is disabled).

## Tuning constants reference

Choreography constants in
[`beats.ts#L9-L80`](../../packages/website/app/components/marketing/story/engine/beats.ts#L9-L80):

| Constant | Value | Controls |
|---|---|---|
| `FRONT_SCALE` | 1.15 | Front-drive parts' scale at the top of `change`, held through `success` |
| `MOUNT_SCALE` | 1.15 | `engineBackCover`'s scale at the top of `related`, held through `success` |
| `FAIL_STOP` | 0.5 | Residual front-drive explode fraction in `failure` — the gap that won't close. (Shipped first at 0.22; visual review found the gap illegible that tight, since front-drive parts sit deep in the assembly — raised to 0.5.) |
| `HIGHLIGHT_GREEN` / `HIGHLIGHT_RED` / `LINK_AMBER` | `#34d399` / `#ef4444` / `#d97706` | Shell/linkage colors for the green resize/success cue, the red mismatch cue, and the amber linkage line |
| `HIGHLIGHT_ORANGE` | `#f97316` | Pre-highlight pulse color on the gear + `engineBackCover` (`preHighlightOrange`) — deliberately distinct from `LINK_AMBER` so it doesn't read as the later linkage beat |
| `MARGIN_ASSEMBLED` | 1.12 | Camera fit margin at `t = 0` (fully assembled); `lerp`ed toward `MARGIN_EXPLODED` across `hero`/`traverse` via `heroTraverseProgress(t)`, not a hard per-phase value |
| `MARGIN_EXPLODED` | 0.85 | Camera fit margin the hero/traverse `lerp` blends toward, and the flat margin for `change`/`span`/`related`. Sits below 1.0 deliberately — the bounding sphere over-estimates the exploded constellation's actual (non-isotropic) silhouette, so a sub-1.0 margin is needed to still land the visible cluster close to the frame edge. |
| `MARGIN_FAILURE` | 1.06 | Camera fit margin `failure`/`second`/`success` ease toward/from over `MARGIN_PUSH_FRACTION` of each phase's own local range (the auto push-in/pull-back) |
| `MARGIN_PUSH_FRACTION` | 0.15 | Fraction of `failure`'s/`second`'s/`success`'s own local range `marginAt` eases the margin over at the top of the phase, instead of snapping — the fix for the "sudden resize" pop at the `change → failure` and `failure → second` boundaries (see [Camera framing](#camera-framing-atmosphere-and-the-never-cropped-constraint)) |
| `HERO_AZIMUTH` / `HERO_ELEVATION` | π / 6° | Hero's static camera angle — a level, end-on shot down the crankshaft axis (front-drive end facing camera), as the engine would present mounted in a car |
| `CANONICAL_AZIMUTH` / `CANONICAL_ELEVATION` | 35° / 18° | The three-quarter technical-drawing angle every phase from `change` onward holds; `hero`/`traverse` `lerp` into it from the hero angle |
| `AZIMUTH_DRIFT` | 18° | Total camera azimuth drift across the whole timeline (parallax while scrubbing) |
| `HERO_IDLE_RATE` | 2π/45 | Hero idle rotation: one full turn per 45s |
| `CAMERA_SETTLE_T` | 12.3 | The `t` value `heroTraverseProgress(t)` fully settles at — camera azimuth/elevation, explode, and margin all reach their canonical/exploded values here and hold flat for the remainder of `traverse` (which itself ends at `t ≈ 18.18`), so the framing is stable while `traverse`'s prose is on screen |
| `IDLE_FADE_FRACTION` | 0.3 | Fraction of the hero+traverse span (`TRAVERSE_END_T`, **not** `CAMERA_SETTLE_T` — the two are deliberately independent) the idle-orbit weight fades out over, starting at `t = 0` |
| `CHANGE_RESIZE_START_T` / `CHANGE_RESIZE_END_T` | 24 / 28 | `t` window `frontDriveScaleAt`/`frontDriveLiftAt` ramp the gear's resize/lift over in `change` — retimed off the phase's earlier local `[0.15, 0.75]` window onto absolute `t` so it lands in step with the highlight window below |
| `GLOW_IN_START_T` / `GLOW_IN_END_T` | 23.5 / 24.5 | `t` window the gear's green / `engineBackCover`'s red glow ramps in over during `change`, just ahead of the resize/lift ramp so the highlight cues the change before it visibly starts |
| `GLOW_OUT_START_T` / `GLOW_OUT_END_T` | 28 / 29 | `t` window the same green/red glow ramps back out over, fully faded before `failure` begins |
| `ORANGE_IN_START_T` / `ORANGE_IN_END_T` | 7.5 / 8 | `t` window `preHighlightOrange` ramps in over (mid-`traverse`) |
| `ORANGE_OUT_START_T` / `ORANGE_OUT_END_T` | 18.5 / 19 | `t` window `preHighlightOrange` ramps back out over — this window deliberately straddles the `traverse → change` phase boundary (`t ≈ 18.18`); `preHighlightOrangeAt` is a plain function of `t`, not phase-gated, so the crossing is trivially continuous |

Pose-synthesis, photoreal-rendering, and interaction constants in
[`EngineScene.ts#L73-L117`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L73-L117):

| Constant | Value | Controls |
|---|---|---|
| `EXPLODE_MIN_FRACTION` / `EXPLODE_MAX_FRACTION` | 0.54 / 1.89 | Bounds (as a fraction of `modelRadius`) the compressed exploded-pose distance is lerped into. Two tuning passes deep: an original 0.30/1.05 was tripled to 0.9/3.15 for a wider, more camera-friendly constellation, then reduced ~40% to the current 0.54/1.89 to tighten the exploded-view zoom. |
| `FRONT_LIFT_FRACTION` | 0.18 | Fraction of the gear's own bounding-sphere radius it (and, scaled by `seatAdjust`, the mount) lifts along `FRONT_LIFT_AXIS` (world +Y) as `frame.frontDriveLift` ramps to 1 — see "The mismatch lift: `frontDriveLift`" above |
| `FOG_NEAR_RADIUS_FRACTION` / `FOG_FAR_RADIUS_FRACTION` | 0.4 / 0.55 | Fog near/far as fractions of the fitted bounding-sphere radius, recomputed every frame from the current camera distance. Densified from an earlier 0.3/1.6 so the exploded view's rearmost parts clearly veil toward the page background. |
| `DRAG_SENSITIVITY` | 0.005 rad/px | Pointer-drag orbit rate |
| `DRAG_AZIMUTH_LIMIT` | 0.9 rad | Max drag azimuth offset (offset-only, on top of the frame's base azimuth) |
| `DRAG_ELEVATION_TOTAL_LIMIT` | 1.2 rad | Max *total* elevation (`frame.elevation + offset`) — clamped against the frame's base so total elevation can't cross the pole |
| `DRAG_SNAP_BACK_RATE` | 4 (1/s) | Exponential ease-back rate for drag offsets after pointer release |
| `GROUND_SHADOW_FOOTPRINT_SCALE` | 1.6 | Fake ground-shadow plane size, relative to the assembled bounding box's larger of X/Z extent |
| `GROUND_SHADOW_DROP_FRACTION` | 0.08 | Fraction of `modelRadius` the ground-shadow plane sits below the oil pan — a visible gap so the engine reads as hovering, not resting |
| `GROUND_SHADOW_TEXTURE_SIZE` | 256 (px) | Resolution of the generated radial-gradient shadow texture |
| tone mapping | `THREE.AgXToneMapping`, exposure `1.15` | Renderer-wide tone-mapping curve, replacing an earlier `ACESFilmicToneMapping`; see [Photoreal rendering](#photoreal-rendering-tone-mapping-studio-hdri-and-the-fake-ground-shadow) for the A/B rationale |
| `environmentIntensity` | 1.1 | Strength of the studio-HDRI-derived PMREM environment map |
| `environmentRotation` | `Euler(0, π·0.35, 0)` | Rotates the HDRI so its brightest softbox falls across the three-quarter camera angle rather than directly behind the lens |

`EXPLODE_OVERRIDES` (`parts.ts`) is data, not a numeric constant, but tunes the same synthesis:
currently `{ gear: { direction: 'reference', minDistanceFraction: 0.9 }, engineBackCover: {
direction: 'own', maxDistanceFraction: 0.63 }, engineBlockCylinderLeft: { direction: 'own',
maxDistanceFraction: 1.0 }, engineBlockCylinderRight: { direction: 'own', maxDistanceFraction: 1.0
} }`, plus `piston001`..`piston008`, each `{ direction: 'own', maxDistanceFraction: 0.5 }` — see
[Pose model](#pose-model-how-exploded-is-derived-read-this-before-touching-poses) for why the
gear/`engineBackCover` pair's fractions are scaled together, why the cylinder-block pair caps each
bank's block below its own head's exploded distance, and why the piston cap (well under both the
block's 1.0 and the head's ~1.3 effective fraction) keeps each bank's pistons nested behind both
instead of parking inside the cylinder head.

Highlight opacity multipliers (0.45 green/mountGreen, 0.55 red, 0.5 orange/coverOrange) and the
linkage draw stagger are inline in
[`updateHighlights()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L805-L821)
and
[`updateLinkage()`](../../packages/website/app/components/marketing/story/engine/EngineScene.ts#L823-L851)
rather than named constants — promote them if they need frequent tuning.

## Related pages

- [`reports/engine-plan.md`](../../reports/engine-plan.md) — the full design plan this
  implementation follows, including the approved amendments (flat materials, sampled exploded
  poses, gap-first failure, amber linkage, transparent canvas, bounding-sphere camera) and their
  rationale.
- [`reports/unified-homepage.md`](../../reports/unified-homepage.md) — the homepage's overall
  narrative, layout, and copy specification (predates the engine swap; its automotive-specific
  sections describe the superseded suspension metaphor, but the page architecture, prose stages,
  and terminal specification still apply).
