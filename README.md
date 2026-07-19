# Audio/Video Clipper — Tampermonkey Userscript

One-click capture audio or video clips from YouTube and BBC pages. Designed for language learners who want to save difficult segments for repeated listening.

[中文](./README_CN.md)

## Features

- **Instant recording** — Press `[` to start, `]` to stop. Captures video timestamps automatically.
- **Audio or video** — Toggle between audio-only (`.webm` Opus) and full video (`.webm` VP9/VP8).
- **Obsidian integration** — Saves a markdown note with frontmatter (source URL, platform, date, timestamps) directly into your Obsidian vault via `obsidian://` URI.
- **Subtitle/notes** — A dialog pops up after stopping; type optional subtitles or notes that get embedded as a blockquote in the saved note.
- **Shadow DOM & iframe traversal** — Finds `<video>` elements inside nested shadow roots and same-origin iframes automatically.
- **Trusted Types compatible** — Works on sites enforcing Trusted Types CSP (e.g., YouTube).

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser.
2. Open [`youtube-bbc-audio-clipper.user.js`](youtube-bbc-audio-clipper.user.js) in this repo.
3. Click **Raw** → Tampermonkey will prompt you to install the script.
4. Navigate to YouTube or BBC, play a video, and the control bar appears in the bottom-right corner.

## Usage

| Action | Key / Click |
|---|---|
| Start recording | `[` |
| Stop recording | `]` |
| Toggle audio / video mode | Click 🎵 button |
| Open settings | Click ⚙ button |
| Save to Obsidian | Click **Save** → type notes → confirm |

### Settings (⚙)

| Setting | Description |
|---|---|
| **Vault** | Your Obsidian vault name (case-sensitive). |
| **Note Folder** | Subfolder within the vault where notes are created (e.g., `English/Clips`). |
| **Media Path** | Vault path prepended to `![[...]]` embeds (e.g., `attachments` → `![[attachments/clip_01-06_to_01-09.webm]]`). |

> **Tip:** Set your browser's download directory to your vault's attachments folder. Downloaded `.webm` files land exactly where `![[...]]` expects them.

### Saved Note Format

```markdown
---
source: "https://www.bbc.co.uk/learningenglish/..."
platform: BBC
date: 20260719
start: "01:06"
end: "01:09"
subtitle: "Let's talk about the weather today."
---
# Learning English — Real Easy English

**BBC** | 01:06 → 01:09

[Open in browser](https://www.bbc.co.uk/...)

> Let's talk about the weather today.

![[attachments/clip_01-06_to_01-09.webm]]
```

## Supported Sites

| Site | Status |
|---|---|
| YouTube (`www.youtube.com`) | ✅ Audio & video |
| BBC (`www.bbc.co.uk`, `*.bbc.co.uk`, `*.bbc.com`) | ✅ Audio & video |

## How It Works

1. **Video discovery** — Recursively searches the DOM, shadow roots, and same-origin iframes for an active `<video>` element.
2. **Stream capture** — Uses `video.captureStream()` for direct capture. Falls back to `getDisplayMedia()` (system audio) when the video element is in a cross-origin iframe.
3. **Recording** — `MediaRecorder` API with WebM container; Opus audio, VP8/VP9 video codecs.
4. **Save** — Downloads the WebM file, then opens an `obsidian://new` URI to create a companion note.

## Why WebM, not MP3/MP4?

Chrome's `MediaRecorder` API only supports the WebM container natively. WebM files play in:
- Browsers (Chrome, Firefox, Edge)
- VLC Media Player
- PotPlayer
- Obsidian (directly)

Convert to MP3/MP4 with any free converter if needed.

## Limitations

- **No retroactive clipping** — Recording is real-time. To capture a specific segment, press `[` before it starts and `]` after it ends.
- **Cross-origin iframes** — When the video lives in a cross-origin iframe (e.g., BBC's `emp.bbc.co.uk` player), the script falls back to system audio capture via `getDisplayMedia()`, which requires a one-time screen-sharing permission per session.
- **Browser download path** — JavaScript cannot set the download destination. Configure your browser's default download folder to point to your Obsidian vault's attachments directory for seamless `![[...]]` embeds.

## License

MIT
