---
name: scroll-world
description: Build an immersive scroll-scrubbed product homepage with a continuous cinematic journey. Use OpenAI/Codex image generation for cohesive scene stills, build a working still-first homepage with video integration points, export a provider-neutral image-to-video handoff with recommended prompts, pause for the user to create videos in a third-party service, then import, encode, wire, and validate the returned clips. Use for developer tools, technical products, infrastructure, and other products whose value is best explained through a problem-first visual story.
---

# Scroll World

Build a complete product homepage in two phases:

1. Generate cohesive scene images with OpenAI/Codex, implement a polished still-first homepage, and deliver a video-generation handoff.
2. Pause until the user returns the generated videos, then validate, encode, integrate, and QA them.

Keep the video handoff provider-neutral. Optimize prompts for capable current image-to-video models, including current Google video models, without requiring a particular vendor, UI, or API.

## Non-negotiable outcomes

- Deliver a useful homepage before video generation. Missing video files must never leave blank panels.
- Generate images only through the available OpenAI/Codex image-generation capability. Do not use a third-party image model.
- Do not call, automate, or require a third-party video service. Hand the user local image files, prompts, settings, filenames, and an import manifest.
- Stop after the handoff and explicitly wait for the returned video files.
- Resume from the manifest rather than reconstructing filenames or scene order from memory.
- Explain the product accurately before making it cinematic. Motion supports the narrative; it does not replace it.
- Use plain language before specialized terminology. Target a reader who knows the product's general domain but not its architecture.
- State concrete product boundaries near the claims they qualify.

## Resources

- Read `references/prompts.md` when planning scenes or writing image/video prompts.
- Read `references/pipeline.md` when creating the handoff or importing returned videos.
- Copy or adapt `references/scrub-engine.js` for a framework-neutral implementation.
- Use `references/index-template.html` only as a minimal standalone starting point.
- Use `references/knockout.py` only for flat-background floating illustrations.

## Phase 1: understand the product

Inspect the user's product materials and existing site before asking questions. Ask only what cannot be discovered or safely defaulted. Ask questions one at a time.

Capture:

- product name and one-sentence description;
- primary audience and desired action;
- the important problem, including a concrete failure that ordinary checks can miss;
- the product's mechanism and the judgment it leaves to people or agents;
- proof points that are supported by available materials;
- brand palette, typography, logo, and tone;
- target framework and existing homepage constraints;
- desktop-only or desktop plus mobile video variants.

Never invent proof, metrics, integrations, guarantees, or customer claims.

## Phase 1: design the homepage story

Use a problem-first sequence for technical products:

1. **Hero:** show a familiar change or task that appears complete but is not.
2. **Hidden relationship:** reveal the distant item, assumption, policy, or dependency that ordinary tools cannot see.
3. **Name the idea:** introduce the product's specialized term only after the ordinary idea is clear.
4. **Running example:** carry one concrete example through the full workflow.
5. **Product mechanism:** show what the product records, connects, or makes visible, including why the relationship matters.
6. **Workflow:** show the short operating loop, such as connect, change, review.
7. **Tool boundary:** compare what familiar tools know with what this product adds.
8. **Transfer:** show a small range of other use cases without repeating the entire explanation.
9. **Selectivity:** explain when to use the product and when not to.
10. **People and agents:** explain how explicit project context helps both without claiming automatic correctness.
11. **Limits:** distinguish mechanical detection from semantic judgment.
12. **Closing:** turn the product into durable project or organizational memory and give one clear CTA.

Keep one idea per section. A section's visual, headline, and body must answer the same question. Avoid beginning with commands, file formats, hashes, internal state names, or implementation details.

For relationship-oriented products, use careful language: a detected change creates a review obligation, not proof of an error or an automatic requirement to edit another item.

## Phase 1: plan the visual journey

Use 5–8 scenes. Prefer visual metaphors grounded in the actual product:

- a clean workspace with one apparently finished change;
- an overlooked distant artifact;
- a visible bridge or thread between separated items;
- a focused diagram of the recorded relationship and its reason;
- a review path branching into several valid outcomes;
- a restrained comparison of visible versus hidden dependencies;
- a network becoming shared memory;
- a calm final product state with the CTA.

Avoid generic floating dashboards, illegible fake interfaces, decorative code, and text rendered inside generated images. Put all readable copy in HTML.

Choose one art direction and repeat its style preamble verbatim across every prompt. Default to cinematic, tactile, editorial 3D with restrained depth, clear focal hierarchy, and enough negative space for HTML copy. Use a diorama only when the product story benefits from a map-like world.

## Phase 1: generate images with OpenAI/Codex

Use the image-generation tool directly for each scene. Generate landscape source images suitable for a full-bleed 16:9 viewport. If mobile video is requested, keep focal subjects within the center safe area; generate separate portrait keyframes only when a center crop would fail.

For each scene:

1. Write the prompt from `references/prompts.md`.
2. Generate the image with OpenAI/Codex.
3. Save it under the project's chosen asset directory with the exact manifest filename.
4. Inspect it for cohesion, focal placement, unwanted text, product accuracy, and transition potential.
5. Regenerate only the scenes that fail review.

Preserve the original generated files. Create optimized web versions separately. Do not use image-processing scripts to imitate image generation.

## Phase 1: build the still-first homepage

Implement the homepage in the user's existing framework and visual system. If none exists, adapt the portable engine.

The initial configuration must use:

- a valid `still` for every section;
- `clip: null` or an omitted clip property until the returned file exists;
- `connectors: []` unless connector clips are actually returned;
- semantic HTML copy and accessible controls;
- still-image motion that respects `prefers-reduced-motion`;
- responsive center-safe compositions and no empty video containers.

Treat the still-first page as a real deliverable. Validate its narrative, layout, keyboard access, responsive behavior, reduced motion, and asset loading before preparing the handoff.

## Phase 1: create the video handoff

Create a user-visible handoff directory inside the project, normally `video-handoff/`, containing:

```text
video-handoff/
├── README.md
├── manifest.json
├── source-images/
│   ├── 01-hero.png
│   └── ...
└── returned-videos/
```

The handoff README must include:

- the intended continuous journey and ordered shot list;
- a recommended prompt for every clip;
- the source image filename for every clip;
- optional end image where the chosen service supports end-frame conditioning;
- duration, aspect ratio, resolution, frame rate, muted/no-dialogue requirement, and camera direction;
- exact required return filename;
- instructions not to add captions, logos, UI text, music, voice, or cuts;
- a note to preserve the source image's palette, geometry, lighting, and focal subject;
- upload/return instructions for the entire `returned-videos/` directory.

Use `manifest.json` as the machine-readable contract. Follow the schema in `references/pipeline.md`. Use relative paths, stable IDs, and explicit nulls for optional end images and mobile variants.

Recommend one primary clip per section. Use start-and-end images when supported because they give the strongest transition control. When only start-image conditioning is available, ask for each shot to end in a calm forward drift and use short crossfades during integration. Request separate connector clips only when the concept genuinely needs aerial travel between diorama islands; do not make connectors the default.

After delivering the working homepage and handoff, stop. Tell the user exactly where to place the returned files and explicitly await them. Do not fabricate placeholder MP4 files or claim video QA is complete.

## Phase 2: receive and audit returned videos

When the user says the videos are ready:

1. Locate the handoff manifest and returned directory.
2. Fail closed on missing, duplicated, misnamed, unreadable, or zero-byte files.
3. Run `ffprobe` on every file and compare it with the manifest.
4. Inspect the first and last frame of every clip.
5. Check scene identity, direction of travel, unexpected cuts, embedded text, aspect ratio, duration, resolution, and color shifts.
6. Report any clip that needs regeneration with a corrected prompt. Integrate only after all required clips pass.

Do not silently reorder files or substitute one scene's clip for another.

## Phase 2: encode and integrate

Follow `references/pipeline.md` to normalize returned clips for scrubbing. Preserve native resolution, strip audio, use H.264/yuv420p, add faststart, and use a short GOP. Create mobile variants only if requested.

Wire the validated paths into the page configuration. Keep each still as the poster and loading fallback. Use a short crossfade at seams; never hide a discontinuity with a long dissolve.

If end-frame conditioning was used, compare neighbouring boundary frames. If it was not available, judge both position and camera velocity at each seam. A matching subject with a reversed camera direction still reads as a stutter.

## Phase 2: final QA

Verify:

- the first screen states both the concrete problem and the product answer;
- specialized terms follow their plain-language explanation;
- every claim is supported and every limitation is specific;
- video timing reinforces the copy rather than making it unreadable;
- scrolling forward and backward remains coherent;
- posters remain visible until video frames paint;
- reduced motion loads no scrubbed video;
- phone crops preserve focal subjects;
- all clip URLs load and `video.seekable.end(0) > 0` after blob loading;
- no seam pops, black frames, console errors, layout jumps, or inaccessible controls remain.

Run the repository's required lint, type checks, tests, and final validation after code or configuration changes.

## Handoff language

At the Phase 1 pause, say plainly:

> The homepage is complete in still-first mode. The video handoff is in `<path>`. Generate each clip using its matching source image and prompt, place the returned files in `<path>/returned-videos/` without renaming them, then tell me the files are ready. I will validate, encode, integrate, and QA them.
