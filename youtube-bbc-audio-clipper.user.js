// ==UserScript==
// @name         Audio/Video Clipper for YouTube & BBC
// @namespace    https://github.com/video-seg-capture
// @version      1.2.0
// @description  截取 YouTube / BBC 的音频或视频片段。1.1: shadow DOM + iframe 递归查找
// @author       you
// @match        https://www.youtube.com/*
// @match        https://www.bbc.co.uk/*
// @match        https://*.bbc.co.uk/*
// @match        https://*.bbc.com/*
// @icon         https://www.google.com/s2/favicons?domain=youtube.com
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // 不在 iframe 里画 UI — 顶层窗口会通过 findVideoInFrames 递归进去找
  if (window !== window.top) return;

  // ── 状态 ────────────────────────────────────────────
  let recorder = null;
  let chunks = [];
  let isRecording = false;
  let stream = null;
  let mode = 'audio'; // 'audio' | 'video'
  let fallbackStream = null; // getDisplayMedia 兜底流

  // ── 日志（调试用，生产可删） ──────────────────────────
  const DEBUG = true;
  const log = (...args) => DEBUG && console.log('[Clipper]', ...args);

  // ── UI ─────────────────────────────────────────────
  const css = `
#aclip-bar * { box-sizing:border-box; margin:0; padding:0; }
#aclip-bar {
  position:fixed; bottom:20px; right:20px; z-index:99999;
  display:flex; gap:8px; align-items:center;
  padding:10px 14px;
  background:#1a1a2e; color:#eee;
  border-radius:10px; font:13px/1.4 system-ui,sans-serif;
  box-shadow:0 4px 24px rgba(0,0,0,.5);
  user-select:none;
}
#aclip-btn {
  width:44px; height:44px; border-radius:50%; border:3px solid #e94560;
  background:transparent; cursor:pointer;
  display:flex; align-items:center; justify-content:center;
  transition: all .15s;
}
#aclip-btn:hover { background:#e9456020; }
#aclip-btn.recording { background:#e94560; border-color:#e94560; }
#aclip-dot {
  width:14px; height:14px; border-radius:50%;
  background:#e94560; transition:all .15s;
}
#aclip-btn.recording #aclip-dot { border-radius:3px; width:10px; height:10px; }
#aclip-timer { font-variant-numeric:tabular-nums; min-width:42px; text-align:center; font-size:14px; font-weight:600; }
#aclip-mode { font-size:11px; color:#888; cursor:pointer; padding:2px 6px; border-radius:4px; border:1px solid #444; }
#aclip-mode:hover { color:#ccc; border-color:#666; }
#aclip-mode.video { border-color:#e94560; color:#e94560; }
#aclip-msg { position:fixed; bottom:80px; right:20px; z-index:100000;
  padding:8px 14px; border-radius:6px; font:13px system-ui;
  background:#333; color:#fff; opacity:0; transition:opacity .3s;
  pointer-events:none;
}
`;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'aclip-bar';
  bar.innerHTML = `
    <button id="aclip-btn" title="录制 / 停止"><div id="aclip-dot"></div></button>
    <span id="aclip-timer">00:00</span>
    <span id="aclip-mode" title="点击切换 音频/视频 模式">🎵</span>
  `;
  document.body.appendChild(bar);

  const btn = document.getElementById('aclip-btn');
  const timerEl = document.getElementById('aclip-timer');
  const modeEl = document.getElementById('aclip-mode');
  let timerInterval = null;
  let startTime = 0;

  const msg = document.createElement('div');
  msg.id = 'aclip-msg';
  document.body.appendChild(msg);
  const toast = (text, ms = 2500) => {
    msg.textContent = text;
    msg.style.opacity = '1';
    clearTimeout(msg._t);
    msg._t = setTimeout(() => { msg.style.opacity = '0'; }, ms);
  };

  // ── 模式切换 ────────────────────────────────────────
  modeEl.addEventListener('click', () => {
    mode = mode === 'audio' ? 'video' : 'audio';
    modeEl.textContent = mode === 'audio' ? '🎵' : '🎬';
    modeEl.className = mode;
    toast(mode === 'audio' ? '音频模式 — 只录声音' : '视频模式 — 录画面+声音');
  });

  // ═══════════════════════════════════════════════════════
  //  核心：递归查找 <video> 元素
  // ═══════════════════════════════════════════════════════

  // 在一个 root 内搜索，包括 shadow DOM
  function findVideosInRoot(root) {
    const videos = [];
    // 1. 当前 root 的 video 元素
    root.querySelectorAll('video').forEach(v => videos.push(v));
    // 2. 递归进入所有元素的 shadowRoot
    const allElems = root.querySelectorAll('*');
    for (const el of allElems) {
      if (el.shadowRoot) {
        videos.push(...findVideosInRoot(el.shadowRoot));
      }
    }
    return videos;
  }

  // 递归搜索当前窗口 + 所有可访问的 (同源) iframe
  function findVideoInFrames(win, depth = 0) {
    if (depth > 5) return null; // 安全深度

    const videos = findVideosInRoot(win.document);
    const live = videos.find(v => v.readyState >= 2 && v.duration > 0);
    if (live) {
      log(`找到 video: ${win.location.href} (depth=${depth})`, live);
      return live;
    }

    // 递归进同源 iframe
    const iframes = win.document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const idoc = iframe.contentDocument;
        const iwin = iframe.contentWindow;
        if (idoc && iwin) {
          const v = findVideoInFrames(iwin, depth + 1);
          if (v) return v;
        }
      } catch (_) {
        // 跨域 iframe — 无法访问
      }
    }
    return null;
  }

  // 诊断输出：列出所有 iframe（帮助了解页面结构）
  function dumpIframes(win, depth = 0) {
    const prefix = '  '.repeat(depth);
    const iframes = win.document.querySelectorAll('iframe');
    log(`${prefix}${win.location.href} — ${iframes.length} iframe(s)`);
    for (const iframe of iframes) {
      try {
        const idoc = iframe.contentDocument;
        if (idoc) {
          dumpIframes(iframe.contentWindow, depth + 1);
        } else {
          log(`${prefix}  ⛔ 跨域 iframe: ${iframe.src}`);
        }
      } catch (_) {
        log(`${prefix}  ⛔ 跨域 iframe: ${iframe.src}`);
      }
    }
  }

  function findVideo() {
    const v = findVideoInFrames(window);
    if (v) return v;
    // 找不到，输出诊断
    log('── 诊断：搜索范围内的 iframe 结构 ──');
    dumpIframes(window);
    log('── 诊断结束 ──');
    return null;
  }

  // ── 从 video 获取流 ─────────────────────────────────
  function getStreamFromVideo(video) {
    if (mode === 'audio') {
      const s = video.captureStream();
      const audioTrack = s.getAudioTracks()[0];
      if (!audioTrack) {
        toast('⚠ 没找到音轨（可能视频静音了）');
        return null;
      }
      return new MediaStream([audioTrack]);
    }
    return video.captureStream();
  }

  // ── 兜底：系统音频捕获 ──────────────────────────────
  // ponytail: getDisplayMedia 每次弹系统对话框，体验一般；聊胜于无
  async function getFallbackStream() {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true, // Chrome 要求 video 必须为 true
      });
      // 丢掉视频轨，只要音频
      s.getVideoTracks().forEach(t => t.stop());
      const audioTrack = s.getAudioTracks()[0];
      if (!audioTrack) {
        toast('⚠ 未选择音频共享');
        return null;
      }
      return new MediaStream([audioTrack]);
    } catch (e) {
      if (e.name === 'AbortError') return null; // 用户取消
      toast('⚠ 系统音频捕获失败: ' + e.message);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════
  //  录制
  // ═══════════════════════════════════════════════════════

  async function startRecording() {
    // 1. 尝试从 video 元素捕获
    const video = findVideo();
    if (video) {
      stream = getStreamFromVideo(video);
      if (!stream) return;
    } else {
      // 2. 兜底：系统音频
      toast('未找到 video 元素，使用系统音频捕获…');
      stream = await getFallbackStream();
      if (!stream) return;
    }

    chunks = [];
    const mime = mode === 'video'
      ? (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
          ? 'video/webm;codecs=vp9,opus'
          : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
            ? 'video/webm;codecs=vp8,opus'
            : 'video/webm')
      : (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm');

    try {
      recorder = new MediaRecorder(stream, { mimeType: mime });
    } catch {
      recorder = new MediaRecorder(stream);
    }

    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = saveClip;
    recorder.start(100);

    isRecording = true;
    btn.classList.add('recording');
    startTime = Date.now();
    timerInterval = setInterval(updateTimer, 200);
    updateTimer();
    toast('🔴 录制中…再点一下停止');
  }

  function stopRecording() {
    if (!recorder || recorder.state === 'inactive') return;
    recorder.stop();
    stream.getTracks().forEach((t) => t.stop());
    stream = null;

    isRecording = false;
    btn.classList.remove('recording');
    clearInterval(timerInterval);
  }

  function updateTimer() {
    const elapsed = Date.now() - startTime;
    const s = Math.floor(elapsed / 1000);
    const m = Math.floor(s / 60);
    const ss = s % 60;
    timerEl.textContent = `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  function saveClip() {
    const blob = new Blob(chunks, { type: recorder.mimeType });
    // MediaRecorder 只出 WebM 容器，原生做不到 MP3/MP4
    // .webm 兼容性好：VLC / Chrome / PotPlayer 都能直接播
    const ext = '.webm';
    const name = 'clip_' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + ext;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    const dur = ((Date.now() - startTime) / 1000).toFixed(1);
    toast(`✅ 已保存 — ${dur}s`);
  }

  // ── 按钮 & 快捷键 ──────────────────────────────────
  btn.addEventListener('click', () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR' && e.ctrlKey && !e.target.closest('input,textarea,[contenteditable]')) {
      e.preventDefault();
      btn.click();
    }
  });

  log('🎵 Audio/Video Clipper v1.1 ready — Ctrl+R 录制');
})();
