
Use /workspace/reports/video-pitches-emotional-v3/pitch-charlie.md and /home/node/video2/charlie-v0 as starting points. Follow the relevant instructions in /home/node/video2/wiki/demos/index.md to rework the concept and /home/node/video2/wiki/style-guide/index.md to compose a hyperframes video based on pitch-charlie.md in /home/node/video2/charlie/.

You may request image plates from codex using `codex -p`. You may install any applications necessary using `apt.`.

Do not modify or delete files outside of /home/node/video2/charlie/.

Smoke test when possible; view frames directly.

Use sonnet model subagents whenever viable. Think about difficult issues using additional effort and xhigh levels.

Regularly use subagents to view frames of the hyperframes videos directly, and to make sure the video meets the goals defined in `<goal>` below. When each subagent returns, identify how you would have structured the video differently if you were starting from scratch to address the feedback. And then build a new video based on that version and use SendMessage to notify the reviewing agent of the new version, and to trigger a review. Iterate this process until the subagents are fully satisfied with the outcome.

<goal>
Illustrate git-span's real value accurately. Every terminal frame must be potential output from the shipped binary, staying honest even where honesty cost impact.
</goal>

<goal>
Land emotionally like the great tear-jerker commercials. The whole film was engineered around one feeling — recognizing your own past care — delivered via the match-cut peak and protected silence rather than a swell.
</goal>

<goal>
Benchmark against the best contemporary launch films. The video should stand next to the launch videos from companies like Linear, Vercel, Stripe, and Apple — restraint over feature-dumping, a single emotional throughline instead of a checklist, and the confidence to hold on silence and negative space rather than fill every second. It earns attention the way those films do: precise craft, an honest product truth told as a human story, and not one decorative frame that hasn't earned its place.
</goal>

Include a "human-detail' subagent into the reviewers pool. This subagent should, based on its knowledge of the human visual system and prior to viewing an image version of the shot, create a list of details a person might identify as "non-human" or "unpolished". The subagent should then view the shot (or screenshot of it) and identify any of those details exist. (For example, realistically proportioned user interface elements.) Finally, it should relate any findings to the team-lead, main agent.

You may also be more ambitious with the color palette, however basing it on the style guide.

Interjected text - such as labels or captions on slides - should have a visually distinctive font.

Terminal whitespace (padding/margins) should be consistent with Mac terminal apps, and text should be top-left aligned.

Check the spacing on the close/minimize buttons on the fake terminal.

You have full latitude to change the plot or examples to address subagent reviewer issues.

You may use still images from Codex as stand-ins for up to 10 second long video clips of the same subject. The reviewing subagents should be aware of when images are used to represent video clips.

Read files in /home/node/video2/wiki/**/*.md directly, do not dispatch a subagent to summarize.

You may override the style guidelines as necessary to accomodate this information and meet the goals. Create a document in
  /home/node/video2/charlie/ containing any changes you made from the /wiki/style-guide/ guidelines.

You may use the x.AI API to create voiceovers and characters. Dispatch a sonnet model subagent to research the API and how to use it effectively. The XAI_API_KEY env var can be used with the latest TTS model. Do not read or print XAI_API_KEY directly. Use TTS transcript timing to sync audio to motion graphics and typography.

You may request background music from Suno.com. Dispatch a sonnet model subagent to research the API and how to use it effectively. Put the request parameters in a /home/node/video2/charlie/SONG.md file.

Use mockups of motion graphics, unique visual representations of adjacent or related issues,  and/or section breaks to break up terminal usage.

Load the `hyperframes-animation` skill and use a diversity of visual techniques, carefully used together to create a complementary set of storytelling techniques.

Image plates of physical objects should use a contemporary, midcentury-modern adjacent style.

With each revision, increase the level of motion graphic and production creativity.
---

/goal Use subagents to iterate to make the hyperframes video meet the following goals:

<goal>
Illustrate git-span's real value accurately. Every terminal frame must be potential output from the shipped binary, staying honest even where honesty cost impact.
</goal>

<goal>
Land emotionally like the great tear-jerker commercials.
</goal>

<goal>
Benchmark against the best contemporary launch films. The video should stand next to the launch videos from companies like Linear, Vercel, Stripe, and Apple — restraint over feature-dumping, a single emotional throughline instead of a checklist, and the confidence to hold on silence and negative space rather than fill every second. It earns attention the way those films do: precise craft, an honest product truth told as a human story, and not one decorative frame that hasn't earned its place.
</goal>

---


