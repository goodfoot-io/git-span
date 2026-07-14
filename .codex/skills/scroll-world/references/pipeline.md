# Video handoff and import pipeline

This pipeline never calls a video-generation provider. It packages OpenAI/Codex-generated source images and defines the contract for videos the user creates elsewhere.

## Handoff manifest

Create `video-handoff/manifest.json` with this shape:

```json
{
  "version": 1,
  "aspectRatio": "16:9",
  "target": {
    "durationSeconds": 8,
    "minimumWidth": 1920,
    "minimumHeight": 1080,
    "preferredFps": 24,
    "audio": false
  },
  "clips": [
    {
      "id": "01-hero",
      "kind": "section",
      "sourceImage": "source-images/01-hero.png",
      "endImage": null,
      "promptFile": "prompts/01-hero.txt",
      "returnedFile": "returned-videos/01-hero.mp4",
      "mobileReturnedFile": null,
      "required": true
    }
  ]
}
```

Use ordered, zero-padded IDs. Add `prompts/` to the handoff directory and write one plain-text prompt per clip. If a service supports end-frame conditioning, set `endImage` to the next scene image; otherwise keep it `null`. Do not change the manifest after giving it to the user unless both parties agree to regenerate the handoff.

## Handoff README checklist

Tell the user to:

1. Generate one video for every required manifest entry.
2. Use the matching source image, optional end image, and prompt file.
3. Choose the highest-quality current image-to-video model available.
4. Prefer 16:9, 1080p or higher, 24 or 30 fps, and the requested duration.
5. Disable generated audio, dialogue, captions, and logos.
6. Download the original result without trimming, filters, interpolation, or added music.
7. Preserve the exact `returnedFile` basename.
8. Place every file in `video-handoff/returned-videos/` and return the directory.

The current Google video model is a suitable initial choice when it accepts the requested source/end images, but the contract must remain usable with another capable service.

## Audit returned files

From the project root, enumerate expected files from the manifest and fail if any required file is missing. For each returned file run:

```bash
ffprobe -v error -show_entries \
  format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt \
  -of json video-handoff/returned-videos/01-hero.mp4
```

Reject zero-byte, unreadable, portrait, severely undersized, or audio-dependent output. A returned audio stream is acceptable only if it can be stripped and the visual does not rely on it.

Extract boundary frames for visual inspection:

```bash
mkdir -p video-handoff/review-frames
ffmpeg -v error -y -ss 0 -i video-handoff/returned-videos/01-hero.mp4 \
  -frames:v 1 video-handoff/review-frames/01-hero-first.png
ffmpeg -v error -y -sseof -0.12 -i video-handoff/returned-videos/01-hero.mp4 \
  -frames:v 1 video-handoff/review-frames/01-hero-last.png
```

Inspect the video itself as well as boundary frames. Frames alone cannot reveal cuts, speed changes, or morphing.

## Encode for scroll scrubbing

Create the site's video asset directory and encode each approved source at its native dimensions:

```bash
mkdir -p assets/vid
ffmpeg -v error -y -i video-handoff/returned-videos/01-hero.mp4 -an \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p \
  -g 8 -keyint_min 8 -sc_threshold 0 -movflags +faststart \
  assets/vid/01-hero.mp4
```

Do not upscale. Use a light sharpen only after visual inspection shows that the returned video needs it.

For an opted-in mobile variant:

```bash
ffmpeg -v error -y -i video-handoff/returned-videos/01-hero.mp4 -an \
  -vf "scale=-2:720" -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p \
  -g 4 -keyint_min 4 -sc_threshold 0 -movflags +faststart \
  assets/vid/01-hero-m.mp4
```

## Wire the page

Before return:

```js
{ id: 'hero', still: 'assets/01-hero.webp', clip: null }
```

After validation and encoding:

```js
{
  id: 'hero',
  still: 'assets/01-hero.webp',
  clip: 'assets/vid/01-hero.mp4',
  clipMobile: 'assets/vid/01-hero-m.mp4'
}
```

Omit `clipMobile` when mobile variants were not requested. Keep `connectors: []` unless the manifest contains approved connector entries.

## Integration checks

- Every manifest ID maps to exactly one page section or connector.
- Every configured URL exists.
- Posters remain present while video loads or fails.
- Clip order matches the manifest, never filesystem sorting by accident.
- Adjacent shots maintain subject, camera direction, palette, and lighting.
- Short crossfades soften small generative differences without concealing a wrong shot.
- The page works when videos are unavailable and under reduced motion.
