# Prompt templates

Use these templates after the product narrative and scene order are approved. Keep the style preamble identical across all image prompts.

## Shared image style

Default:

```text
Cinematic editorial 3D illustration, tactile materials, restrained depth, precise visual hierarchy, sophisticated but approachable, cohesive palette of [PALETTE], soft directional studio light, subtle atmospheric depth, polished product-homepage art direction. Landscape 16:9 composition with the focal subject centered inside the middle 50% of the frame and intentional negative space for HTML copy. No text, letters, numbers, logos, captions, watermarks, or legible interface labels.
```

Replace the medium when the brand calls for it, but retain the composition, palette, light, and no-text constraints. Prefer one connected world over unrelated hero illustrations.

## Scene image

```text
[SHARED STYLE PREAMBLE]

Narrative beat: [QUESTION THIS SECTION ANSWERS].
Scene: [CONCRETE PHYSICAL SCENE OR GROUNDED VISUAL METAPHOR].
Focal subject: [ONE CLEAR SUBJECT].
Supporting details: [TWO TO FOUR DETAILS THAT EXPLAIN THE IDEA].
Connection to the next scene: include [DOORWAY / PATH / THREAD / OPENING / DIRECTION] leading toward [NEXT BEAT], with clear room for a slow forward camera move.
Mood: [TONE]. Keep all readable product explanation outside the image in HTML.
```

Review every result for consistent camera height, lighting direction, material language, palette, scale, and focal placement.

## Section copy

For each scene, write:

- `eyebrow`: 2–4 plain words;
- `title`: 3–8 words answering the section's question;
- `body`: one or two short sentences at roughly an eighth-grade reading level;
- `tags`: zero to three supported proof labels;
- `cta`: only where the reader has enough context to act.

Keep the running example consistent across the problem, mechanism, and review scenes.

## Primary image-to-video prompt

Use one clip per section by default:

```text
Create one continuous cinematic shot with no cuts. Start from the supplied image and preserve its subject, geometry, palette, materials, lighting, and visual style. Continue a slow, steady forward camera glide toward [FOCAL SUBJECT]. [OPTIONAL MID-SHOT MOVE: gentle half-orbit / low lateral track / crane reveal / close push-in], then return to a calm, slow forward drift during the final second toward [NEXT DIRECTION]. Add only subtle environmental motion: [TWO SPECIFIC MOTIONS]. Keep the scene stable and physically coherent. No new objects, morphing, captions, letters, logos, interface text, people speaking, dialogue, voice-over, music, sound effects, or cuts. Silent visual only.
```

If the service supports an end image, add:

```text
Arrive smoothly at the supplied end image without a cut or abrupt speed change. Preserve continuous forward camera velocity through the final frame.
```

## Motion grammar

- Product or luxury: slow half-orbit, then continue past the subject.
- Architecture or platforms: steady glide through an opening; gentle crane reveal.
- Process or infrastructure: low lateral track with foreground parallax.
- Craft or detail: restrained push-in, ease back, then continue forward.
- Networks or relationships: follow one illuminated thread as other connections resolve into view.
- Review or decisions: approach a branching path, slow at the decision point, then continue toward the resolved state.

Avoid reversing direction at clip boundaries.

## Optional connector prompt

Use only for a miniature or map-like world:

```text
Create one continuous silent camera move with no cuts. Begin exactly from the supplied start image. Rise gently above [CURRENT SCENE], travel forward along the visible path through the same connected world, and descend toward [NEXT SCENE], arriving smoothly at the supplied end image. Preserve the same palette, materials, light, scale, and camera character. No new objects, text, logos, dialogue, audio, morphing, or abrupt direction changes.
```

## Regeneration corrections

Add only the correction that addresses the observed failure:

- Style drift: `Match the supplied image exactly; do not reinterpret the art direction.`
- Morphing: `Keep object shapes and counts stable throughout the shot.`
- Added text: `Do not render any symbols or writing anywhere in the frame.`
- Bad ending: `During the final second, settle into a slow forward drift with no orbit, pan, or pull-back.`
- Excess motion: `Use restrained camera motion and subtle environmental animation only.`
- Mobile crop: `Keep the focal subject and all essential action inside the central vertical half of the frame.`
