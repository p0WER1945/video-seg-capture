# 音视频片段截取助手 — 油猴脚本

一键截取 YouTube / BBC 网页中正在播放的音频或视频片段。专为英语听力练习设计：把听不出来的片段存下来反复听。

[English](./README.md)

## 功能

- **快捷键录制** — 按 `[` 开始，按 `]` 停止，自动记录视频时间戳。
- **音频 / 视频切换** — 纯音频模式（`.webm` Opus）和视频模式（`.webm` VP9/VP8）一键切换。
- **Obsidian 集成** — 通过 `obsidian://` 协议自动在 Obsidian 中创建笔记，包含 frontmatter（来源链接、平台、日期、时间区间）和媒体嵌入。
- **字幕 / 笔记输入** — 停止录制后弹出输入框，可输入字幕或笔记，保存到 Obsidian 笔记中作为引用块。
- **Shadow DOM 和 iframe 穿透** — 自动递归搜索 shadow root 和同源 iframe 中的 `<video>` 元素。
- **兼容 Trusted Types** — 可在强制 Trusted Types CSP 的站点（如 YouTube）正常运行。

## 安装

1. 为浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 打开本仓库中的 [`youtube-bbc-audio-clipper.user.js`](youtube-bbc-audio-clipper.user.js)。
3. 点击 **Raw** → Tampermonkey 会弹出安装提示。
4. 打开 YouTube 或 BBC，播放视频，右下角即出现控制栏。

## 使用方法

| 操作 | 按键 / 点击 |
|---|---|
| 开始录制 | `[` |
| 停止录制 | `]` |
| 切换音频 / 视频模式 | 点击 🎵 |
| 打开设置 | 点击 ⚙ |
| 保存到 Obsidian | 点击 **Save** → 输入笔记 → 确认 |

### 设置说明（⚙）

| 设置项 | 说明 |
|---|---|
| **Vault** | Obsidian Vault 名称（区分大小写）。 |
| **笔记文件夹** | Vault 内的子目录，笔记会创建在此目录下（如 `English/Clips`）。 |
| **媒体文件路径** | `![[...]]` 嵌入前追加的路径前缀（如填入 `attachments` 则生成 `![[attachments/clip_01-06_to_01-09.webm]]`）。 |

> **提示：** 将浏览器的下载目录设置为 Obsidian Vault 的 attachments 文件夹，下载的 `.webm` 文件直接归位，`![[...]]` 嵌入即时生效。

### 笔记格式示例

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

## 支持网站

| 网站 | 状态 |
|---|---|
| YouTube (`www.youtube.com`) | ✅ 音频 & 视频 |
| BBC (`www.bbc.co.uk`, `*.bbc.co.uk`, `*.bbc.com`) | ✅ 音频 & 视频 |

## 技术原理

1. **视频发现** — 递归搜索 DOM、shadow root、同源 iframe，找到正在播放的 `<video>` 元素。
2. **流捕获** — 首选 `video.captureStream()` 直接捕获；当视频位于跨域 iframe 时，降级为 `getDisplayMedia()`（系统音频）。
3. **录制** — `MediaRecorder` API + WebM 容器；音频 Opus 编码，视频 VP8/VP9 编码。
4. **保存** — 下载 WebM 文件，然后通过 `obsidian://new` 协议在 Obsidian 中创建配套笔记。

## 为什么是 WebM 而不是 MP3/MP4？

Chrome 的 `MediaRecorder` API 原生只支持 WebM 容器。WebM 文件可在以下播放器直接播放：
- 浏览器（Chrome、Firefox、Edge）
- VLC Media Player
- PotPlayer
- Obsidian（原生支持）

如需 MP3/MP4 格式，用任意免费转换工具转一下即可。

## 已知限制

- **不能回溯截取** — 录制是实时的。想截某一段，需要在那一段开始前按 `[`，结束后按 `]`。
- **跨域 iframe** — 当视频在跨域 iframe 中时（如 BBC 的 `emp.bbc.co.uk` 播放器），脚本降级为系统音频捕获，每次会话需授权一次屏幕共享。
- **浏览器下载路径** — JS 无法指定文件下载位置。将浏览器默认下载目录设为 Obsidian Vault 的 attachments 文件夹即可无缝配合 `![[...]]` 嵌入。

## 许可证

MIT
