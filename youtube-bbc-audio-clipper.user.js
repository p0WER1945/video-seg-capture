// ==UserScript==
// @name         Audio/Video Clipper for YouTube & BBC
// @namespace    https://github.com/video-seg-capture
// @version      1.3.0
// @description  按 [ 开始录制，按 ] 停止，显示视频时间，Save 按钮保存
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

  if (window !== window.top) return;

  // ── 状态 ────────────────────────────────────────────
  let recorder = null;
  let chunks = [];
  let stream = null;
  let mode = 'audio';
  let recordedVideo = null;   // 正在录制的 video 元素（读 currentTime 用）
  let clipStart = 0;          // 视频时间：录制起点
  let clipEnd = 0;            // 视频时间：录制终点
  let hasClip = false;        // 是否已停止、待保存

  const log = (...args) => console.log('[Clipper]', ...args);

  // ── 时间格式化 ──────────────────────────────────────
  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) return '--:--';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // ── UI ─────────────────────────────────────────────
  const css = `
#aclip-bar * { box-sizing:border-box; margin:0; padding:0; }
#aclip-bar {
  position:fixed; bottom:20px; right:20px; z-index:99999;
  display:flex; gap:10px; align-items:center;
  padding:10px 16px;
  background:#1a1a2e; color:#eee;
  border-radius:10px; font:13px/1.4 system-ui,sans-serif;
  box-shadow:0 4px 24px rgba(0,0,0,.5);
  user-select:none;
}
#aclip-dot {
  width:12px; height:12px; border-radius:50%;
  background:#555; flex-shrink:0; transition:background .2s;
}
#aclip-dot.rec { background:#e94560; animation:aclip-pulse .8s infinite; }
#aclip-dot.done { background:#4ade80; }
@keyframes aclip-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
#aclip-times {
  display:flex; gap:6px; align-items:center;
  font-variant-numeric:tabular-nums; font-size:14px; font-weight:600;
  min-width:110px;
}
#aclip-start { color:#aaa; }
#aclip-sep { color:#555; }
#aclip-end { color:#aaa; }
#aclip-start.set { color:#e94560; }
#aclip-end.set { color:#4ade80; }
#aclip-save {
  display:none;
  padding:6px 14px;
  background:#4ade80; color:#111; border:none;
  border-radius:6px; font-weight:700; font-size:13px; cursor:pointer;
  transition:filter .15s;
}
#aclip-save:hover { filter:brightness(1.1); }
#aclip-save.show { display:block; }
#aclip-mode {
  font-size:11px; color:#888; cursor:pointer;
  padding:2px 6px; border-radius:4px; border:1px solid #444;
  background:transparent;
}
#aclip-mode:hover { color:#ccc; border-color:#666; }
#aclip-mode.video { border-color:#e94560; color:#e94560; }
#aclip-msg {
  position:fixed; bottom:80px; right:20px; z-index:100000;
  padding:8px 14px; border-radius:6px; font:13px system-ui;
  background:#333; color:#fff; opacity:0; transition:opacity .3s;
  pointer-events:none;
}
#aclip-hint {
  position:fixed; bottom:80px; right:20px; z-index:100000;
  padding:6px 12px; border-radius:6px; font:12px system-ui;
  background:#1a1a2e; color:#666; opacity:0; transition:opacity .4s;
  pointer-events:none;
}
`;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // bar
  const bar = document.createElement('div');
  bar.id = 'aclip-bar';
  bar.innerHTML = `
    <div id="aclip-dot"></div>
    <span id="aclip-times">
      <span id="aclip-start">--:--</span>
      <span id="aclip-sep">/</span>
      <span id="aclip-end">--:--</span>
    </span>
    <button id="aclip-save">Save</button>
    <button id="aclip-mode" title="音频/视频 切换">🎵</button>
  `;
  document.body.appendChild(bar);

  const dotEl    = document.getElementById('aclip-dot');
  const startEl  = document.getElementById('aclip-start');
  const endEl    = document.getElementById('aclip-end');
  const saveBtn  = document.getElementById('aclip-save');
  const modeBtn  = document.getElementById('aclip-mode');

  // hint（快捷键提示）
  const hint = document.createElement('div');
  hint.id = 'aclip-hint';
  hint.textContent = '[ 开始录制  |  ] 停止录制';
  document.body.appendChild(hint);
  // 鼠标悬浮 bar 时显示提示
  bar.addEventListener('mouseenter', () => { hint.style.opacity = '1'; });
  bar.addEventListener('mouseleave', () => { hint.style.opacity = '0'; });

  // toast
  const msg = document.createElement('div');
  msg.id = 'aclip-msg';
  document.body.appendChild(msg);
  const toast = (text, ms = 2000) => {
    msg.textContent = text;
    msg.style.opacity = '1';
    clearTimeout(msg._t);
    msg._t = setTimeout(() => { msg.style.opacity = '0'; }, ms);
  };

  // ── 模式切换 ────────────────────────────────────────
  modeBtn.addEventListener('click', () => {
    if (recorder && recorder.state === 'recording') { toast('⚠ 录制中不能切换模式'); return; }
    mode = mode === 'audio' ? 'video' : 'audio';
    modeBtn.textContent = mode === 'audio' ? '🎵' : '🎬';
    modeBtn.className = mode;
    toast(mode === 'audio' ? '音频模式' : '视频模式');
  });

  // ── 重置 UI ─────────────────────────────────────────
  function resetUI() {
    dotEl.className = '';
    startEl.textContent = '--:--';
    startEl.className = '';
    endEl.textContent = '--:--';
    endEl.className = '';
    saveBtn.classList.remove('show');
    hasClip = false;
    recordedVideo = null;
  }

  // ═══════════════════════════════════════════════════════
  //  查找 video（shadow DOM + iframe 递归）
  // ═══════════════════════════════════════════════════════

  function findVideosInRoot(root) {
    const videos = [];
    root.querySelectorAll('video').forEach(v => videos.push(v));
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) videos.push(...findVideosInRoot(el.shadowRoot));
    }
    return videos;
  }

  function findVideoInFrames(win, depth) {
    if (depth > 5) return null;
    const videos = findVideosInRoot(win.document);
    const live = videos.find(v => v.readyState >= 2 && v.duration > 0);
    if (live) return live;
    for (const iframe of win.document.querySelectorAll('iframe')) {
      try {
        const d = iframe.contentDocument;
        if (d) { const v = findVideoInFrames(iframe.contentWindow, depth + 1); if (v) return v; }
      } catch (_) { /* 跨域 */ }
    }
    return null;
  }

  function findVideo() {
    return findVideoInFrames(window, 0);
  }

  // ── 流获取 ──────────────────────────────────────────
  function getStreamFromVideo(video) {
    if (mode === 'audio') {
      const s = video.captureStream();
      const at = s.getAudioTracks()[0];
      if (!at) { toast('⚠ 没找到音轨'); return null; }
      return new MediaStream([at]);
    }
    return video.captureStream();
  }

  async function getFallbackStream() {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      s.getVideoTracks().forEach(t => t.stop());
      const at = s.getAudioTracks()[0];
      if (!at) { toast('⚠ 未选择音频共享'); return null; }
      return new MediaStream([at]);
    } catch (e) {
      if (e.name !== 'AbortError') toast('⚠ 系统音频捕获失败: ' + e.message);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════
  //  录制
  // ═══════════════════════════════════════════════════════

  async function startRecording() {
    if (recorder && recorder.state === 'recording') return; // 已在录制

    const video = findVideo();
    if (!video) {
      toast('未找到 video，尝试系统音频…');
      stream = await getFallbackStream();
      if (!stream) return;
      recordedVideo = null;
    } else {
      stream = getStreamFromVideo(video);
      if (!stream) return;
      recordedVideo = video;
    }

    // 记录视频当前时间
    clipStart = recordedVideo ? recordedVideo.currentTime : 0;

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

    try { recorder = new MediaRecorder(stream, { mimeType: mime }); }
    catch { recorder = new MediaRecorder(stream); }

    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      // 录制停止 → 显示 Save 按钮，不自动保存
      dotEl.className = 'done';
      startEl.className = 'set';
      endEl.className = 'set';
      endEl.textContent = fmt(clipEnd);
      saveBtn.classList.add('show');
      hasClip = true;
      toast('✅ 已停止 — 点 Save 保存');
    };
    recorder.start(100);

    // UI
    dotEl.className = 'rec';
    startEl.textContent = fmt(clipStart);
    startEl.className = 'set';
    endEl.textContent = '--:--';
    endEl.className = '';
    saveBtn.classList.remove('show');
    hasClip = false;
    toast('🔴 录制中…');
  }

  function stopRecording() {
    if (!recorder || recorder.state === 'inactive') return;

    // 记录视频停止时间
    clipEnd = recordedVideo ? recordedVideo.currentTime : 0;

    recorder.stop();
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }

  function saveClip() {
    if (!hasClip || !chunks.length) return;

    const blob = new Blob(chunks, { type: recorder.mimeType });
    const startStr = fmt(clipStart).replace(/:/g, '-');
    const endStr   = fmt(clipEnd).replace(/:/g, '-');
    const name = `clip_${startStr}_to_${endStr}.webm`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
    toast(`✅ 已保存 ${fmt(clipStart)} → ${fmt(clipEnd)}`);
    resetUI();
  }

  // ── Save 按钮 ────────────────────────────────────────
  saveBtn.addEventListener('click', saveClip);

  // ── 快捷键 [ ] ──────────────────────────────────────
  document.addEventListener('keydown', e => {
    // 不拦截输入框
    if (e.target.closest('input,textarea,[contenteditable]')) return;

    if (e.key === '[') {
      e.preventDefault();
      if (recorder && recorder.state === 'recording') return; // 已在录
      if (hasClip) { toast('⚠ 请先 Save 或等待当前片段保存'); return; }
      startRecording();
    }

    if (e.key === ']') {
      e.preventDefault();
      if (!recorder || recorder.state !== 'recording') return; // 没在录
      stopRecording();
    }
  });

  resetUI();
  log('🎵 Clipper v1.3 ready — [ 开始  ] 停止  Save 保存');
})();
