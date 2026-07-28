---
name: create-video
description: Build a hyperframes video from a pitch document by iterating with reviewing subagents until the emotional and craft goals in goals.md are met. Use when asked to turn a pitch (e.g. pitch-foxtrot.md) into a finished hyperframes video, or to iterate an existing one against reviewer feedback.
---

<user-input>
$ARGUMENTS
</user-input>

<instructions>
Use `/workspace/reports/video-pitches-emotional-v3/pitch-foxtrot.md` as a starting point (unless `<user-input>` names a different pitch document). Follow the relevant instructions in `/home/node/video2/wiki/demos/index.md` to rework the concept, and `/home/node/video2/wiki/style-guide/index.md` to compose a hyperframes video based on the pitch, in `/home/node/video2/foxtrot/` (unless `<user-input>` names a different working directory).

Read files in `/home/node/video2/wiki/**/*.md` directly yourself — do not dispatch a subagent to summarize them.

You may request image plates from Codex using `codex -p`. You may install any applications necessary using `apt`.

Do not modify or delete files outside of the working directory (`/home/node/video2/foxtrot/` by default).

You may use still images from Codex as stand-ins for up to 10-second-long video clips of the same subject. The reviewing subagents should be told explicitly whenever images are being used to represent video clips.

You have full latitude to change the plot or examples to address subagent reviewer issues.

You may override the style guide as necessary to accommodate this brief and meet the goals in `goals.md`. Create a document in the working directory recording any changes you made from the `/wiki/style-guide/` guidelines.

### Audio

You may use the x.AI API to create voiceovers and characters. Dispatch a Sonnet-model subagent to research the API and how to use it effectively. The `XAI_API_KEY` env var can be used with the latest TTS model — do not read or print `XAI_API_KEY` directly. Use TTS transcript timing to sync audio to motion graphics and typography.

You may request background music from Suno.com. Dispatch a Sonnet-model subagent to research the API and how to use it effectively. Put the request parameters in a `SONG.md` file in the working directory.

### Breaking up terminal usage

Use mockups of motion graphics, unique visual representations of adjacent or related issues, and/or section breaks to break up terminal usage.

### Review loop

Regularly use subagents to view frames of the hyperframes video directly, and to check the video against the goals in `goals.md`. See `review-loop.md` for the full iteration procedure.

### Model and effort

Use Sonnet-model subagents whenever viable. Think about difficult issues using additional effort and xhigh reasoning-effort levels.

### Smoke testing

Smoke test when possible; view frames directly.
</instructions>

Read `goals.md` for the target outcome and `review-loop.md` for how to iterate with reviewer subagents before starting work.
