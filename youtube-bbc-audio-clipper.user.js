// ==UserScript==
// @name         Audio/Video Clipper for YouTube & BBC
// @namespace    https://github.com/video-seg-capture
// @version      1.6.0
// @description  按 [ 录制，按 ] 停止，Save → 下载 + Obsidian 笔记
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

  // ── 持久化设置 ──────────────────────────────────────
  const LS_VAULT  = 'aclip_vault';
  const LS_FOLDER = 'aclip_folder';
  const LS_MEDIA  = 'aclip_media';
  let vaultName   = localStorage.getItem(LS_VAULT)  || '';
  let vaultFolder = localStorage.getItem(LS_FOLDER) || '';
  let mediaPath   = localStorage.getItem(LS_MEDIA)  || '';

  // ── 状态 ────────────────────────────────────────────
  let recorder = null;
  let chunks = [];
  let stream = null;
  let mode = 'audio';
  let recordedVideo = null;
  let clipStart = 0;
  let clipEnd = 0;
  let hasClip = false;
  let isFallbackStream = false; // getDisplayMedia 的流需要手动 stop

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

  // ── 页面标题 ────────────────────────────────────────
  function pageTitle() {
    // YouTube
    const yt = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
    if (yt) return yt.textContent.trim();
    // BBC / generic
    const h1 = document.querySelector('h1');
    if (h1) return h1.textContent.trim();
    return document.title;
  }

  function pageSource() {
    const u = new URL(location.href);
    if (u.hostname.includes('youtube.com')) return 'YouTube';
    if (u.hostname.includes('bbc.co.uk') || u.hostname.includes('bbc.com')) return 'BBC';
    return u.hostname;
  }

  // ── UI ─────────────────────────────────────────────
  const css = `
#aclip-bar * { box-sizing:border-box; margin:0; padding:0; }
#aclip-bar {
  position:fixed; bottom:20px; right:20px; z-index:99999;
  display:flex; flex-direction:column; gap:6px; align-items:flex-end;
  font:13px/1.4 system-ui,sans-serif;
}
#aclip-row {
  display:flex; gap:10px; align-items:center;
  padding:10px 16px;
  background:#1a1a2e; color:#eee;
  border-radius:10px;
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
#aclip-gear {
  font-size:13px; color:#666; cursor:pointer;
  padding:2px 4px; border-radius:4px; border:1px solid transparent;
  background:transparent; line-height:1;
}
#aclip-gear:hover { color:#aaa; border-color:#444; }
#aclip-gear.active { color:#e94560; }
#aclip-settings {
  display:none;
  padding:10px 14px;
  background:#1a1a2e; color:#eee;
  border-radius:8px;
  box-shadow:0 4px 24px rgba(0,0,0,.5);
  font-size:12px;
}
#aclip-settings.show { display:flex; flex-direction:column; gap:6px; }
.aclip-setting-row {
  display:flex; flex-direction:column; gap:2px;
}
.aclip-setting-row label { color:#888; font-size:11px; }
.aclip-setting-row input {
  width:180px; padding:5px 8px;
  background:#111; color:#eee; border:1px solid #444; border-radius:4px;
  font-size:12px; outline:none;
}
.aclip-setting-row input:focus { border-color:#e94560; }
.aclip-setting-row input::placeholder { color:#555; }
#aclip-msg {
  position:fixed; bottom:80px; right:20px; z-index:100000;
  padding:8px 14px; border-radius:6px; font:13px system-ui;
  background:#333; color:#fff; opacity:0; transition:opacity .3s;
  pointer-events:none;
}
#aclip-dialog {
  display:none; position:fixed; inset:0; z-index:100001;
  background:rgba(0,0,0,.6);
  justify-content:center; align-items:center;
}
#aclip-dialog.show { display:flex; }
#aclip-dialog-box {
  background:#1a1a2e; color:#eee; border-radius:12px;
  padding:20px; width:380px; max-width:90vw;
  box-shadow:0 8px 40px rgba(0,0,0,.6);
}
#aclip-dialog-box textarea {
  width:100%; height:100px; resize:vertical;
  background:#111; color:#eee; border:1px solid #444; border-radius:6px;
  padding:10px; font:13px system-ui; outline:none; margin-bottom:12px;
}
#aclip-dialog-box textarea:focus { border-color:#e94560; }
#aclip-dialog-btns { display:flex; gap:8px; justify-content:flex-end; }
#aclip-dialog-btns button {
  padding:8px 18px; border:none; border-radius:6px;
  font-weight:600; font-size:13px; cursor:pointer;
}
#aclip-dlg-confirm { background:#4ade80; color:#111; }
#aclip-dlg-cancel  { background:#333; color:#aaa; }
#aclip-dlg-confirm:hover { filter:brightness(1.1); }
#aclip-dlg-cancel:hover  { color:#fff; }
`;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ── 构建 DOM ────────────────────────────────────────
  const bar = document.createElement('div');
  bar.id = 'aclip-bar';
  bar.innerHTML = `
    <div id="aclip-settings">
      <div class="aclip-setting-row">
        <label>Vault 名称</label>
        <input id="aclip-vault-input" type="text" placeholder="MyVault" value="${vaultName.replace(/"/g,'&quot;')}">
      </div>
      <div class="aclip-setting-row">
        <label>笔记文件夹（Vault 内）</label>
        <input id="aclip-folder-input" type="text" placeholder="English/Clips" value="${vaultFolder.replace(/"/g,'&quot;')}">
      </div>
      <div class="aclip-setting-row">
        <label>媒体文件路径（Vault 内，给 ![[...]] 嵌入用）</label>
        <input id="aclip-media-input" type="text" placeholder="attachments" value="${mediaPath.replace(/"/g,'&quot;')}">
      </div>
    </div>
    <div id="aclip-row">
      <div id="aclip-dot"></div>
      <span id="aclip-times">
        <span id="aclip-start">--:--</span>
        <span id="aclip-sep">/</span>
        <span id="aclip-end">--:--</span>
      </span>
      <button id="aclip-save">Save</button>
      <button id="aclip-mode" title="音频/视频 切换">🎵</button>
      <button id="aclip-gear" title="Obsidian 设置">⚙</button>
    </div>
  `;
  document.body.appendChild(bar);

  // 字幕弹窗
  const dialog = document.createElement('div');
  dialog.id = 'aclip-dialog';
  dialog.innerHTML = `
    <div id="aclip-dialog-box">
      <textarea id="aclip-subtitle" placeholder="字幕 / 笔记（可选）…"></textarea>
      <div id="aclip-dialog-btns">
        <button id="aclip-dlg-cancel">取消</button>
        <button id="aclip-dlg-confirm">确认保存</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);

  const dotEl       = document.getElementById('aclip-dot');
  const startEl     = document.getElementById('aclip-start');
  const endEl       = document.getElementById('aclip-end');
  const saveBtn     = document.getElementById('aclip-save');
  const modeBtn     = document.getElementById('aclip-mode');
  const gearBtn     = document.getElementById('aclip-gear');
  const settingsEl  = document.getElementById('aclip-settings');
  const vaultInput  = document.getElementById('aclip-vault-input');
  const folderInput = document.getElementById('aclip-folder-input');
  const mediaInput  = document.getElementById('aclip-media-input');
  const subtitleEl  = document.getElementById('aclip-subtitle');
  const dlgConfirm  = document.getElementById('aclip-dlg-confirm');
  const dlgCancel   = document.getElementById('aclip-dlg-cancel');

  // toast
  const msg = document.createElement('div');
  msg.id = 'aclip-msg';
  document.body.appendChild(msg);
  const toast = (text, ms = 2500) => {
    msg.textContent = text;
    msg.style.opacity = '1';
    clearTimeout(msg._t);
    msg._t = setTimeout(() => { msg.style.opacity = '0'; }, ms);
  };

  // ── 设置面板 ────────────────────────────────────────
  gearBtn.addEventListener('click', () => {
    const show = settingsEl.classList.toggle('show');
    gearBtn.classList.toggle('active', show);
  });
  vaultInput.addEventListener('input', () => {
    vaultName = vaultInput.value.trim();
    localStorage.setItem(LS_VAULT, vaultName);
  });
  folderInput.addEventListener('input', () => {
    vaultFolder = folderInput.value.trim().replace(/^\//, '').replace(/\/$/, '');
    localStorage.setItem(LS_FOLDER, vaultFolder);
  });
  mediaInput.addEventListener('input', () => {
    mediaPath = mediaInput.value.trim().replace(/^\//, '').replace(/\/$/, '');
    localStorage.setItem(LS_MEDIA, mediaPath);
  });
  if (!vaultName) {
    setTimeout(() => {
      settingsEl.classList.add('show');
      gearBtn.classList.toggle('active', true);
    }, 500);
  }

  // ── 弹窗 ────────────────────────────────────────────
  dlgCancel.addEventListener('click', () => {
    dialog.classList.remove('show');
  });
  // 点击遮罩也关闭
  dialog.addEventListener('click', e => {
    if (e.target === dialog) dialog.classList.remove('show');
  });

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
  //  查找 video
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

  function findVideo() { return findVideoInFrames(window, 0); }

  // ═══════════════════════════════════════════════════════
  //  流
  // ═══════════════════════════════════════════════════════

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
    if (recorder && recorder.state === 'recording') return;

    const video = findVideo();
    if (!video) {
      toast('未找到 video，尝试系统音频…');
      stream = await getFallbackStream();
      if (!stream) return;
      recordedVideo = null;
      isFallbackStream = true;
    } else {
      stream = getStreamFromVideo(video);
      if (!stream) return;
      recordedVideo = video;
      isFallbackStream = false;
    }

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
      dotEl.className = 'done';
      startEl.className = 'set';
      endEl.className = 'set';
      endEl.textContent = fmt(clipEnd);
      saveBtn.classList.add('show');
      hasClip = true;
      toast('✅ 已停止 — 点 Save 保存到 Obsidian');
    };
    recorder.start(100);

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
    clipEnd = recordedVideo ? recordedVideo.currentTime : 0;
    recorder.stop();
    // captureStream 的轨不能 stop，会杀掉原视频的音频管线
    if (isFallbackStream) stream.getTracks().forEach(t => t.stop());
    stream = null;
  }

  // ═══════════════════════════════════════════════════════
  //  Save → 弹窗 → 下载 + Obsidian 笔记
  // ═══════════════════════════════════════════════════════

  function doSave(subtitle) {
    if (!hasClip || !chunks.length) return;

    const startTag = fmt(clipStart).replace(/:/g, '-');
    const endTag   = fmt(clipEnd).replace(/:/g, '-');
    const fileName = `clip_${startTag}_to_${endTag}.webm`;

    // 1. 下载 — 用 appendChild 而非裸 click，避免干扰页面
    const blob = new Blob(chunks, { type: recorder.mimeType });
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = dlUrl; a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(dlUrl);
    }, 200);

    // 2. 生成笔记内容
    const title = pageTitle();
    const source = pageSource();
    const pageUrl = location.href;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
    const embedPath = mediaPath ? `${mediaPath}/${fileName}` : fileName;

    const lines = [
      '---',
      `source: "${pageUrl}"`,
      `platform: ${source}`,
      `date: ${dateStr}`,
      `start: "${fmt(clipStart)}"`,
      `end: "${fmt(clipEnd)}"`,
    ];
    if (subtitle) lines.push(`subtitle: "${subtitle.replace(/"/g, '\\"')}"`);
    lines.push(
      '---',
      '',
      `# ${title}`,
      '',
      `**${source}** | ${fmt(clipStart)} → ${fmt(clipEnd)}`,
      '',
      `[Open in browser](${pageUrl})`,
      '',
    );
    if (subtitle) lines.push(`> ${subtitle.replace(/\n/g, '\n> ')}`, '');
    lines.push(`![[${embedPath}]]`, '');

    const note = lines.join('\n');
    const noteName = `${source.toLowerCase()}_${dateStr}_${timeStr}`
      .replace(/[\\/:*?"<>|]/g, '-');

    // 3. Obsidian 笔记 — 延迟用 window.open，不和下载挤同一帧
    setTimeout(() => {
      if (vaultName) {
        const filePath = vaultFolder ? `${vaultFolder}/${noteName}` : noteName;
        const uri = `obsidian://new?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(filePath)}&content=${encodeURIComponent(note)}`;
        window.open(uri, '_blank');
        toast(`✅ 已保存 — ${vaultFolder ? vaultFolder + '/' : ''}${noteName}`);
      } else {
        navigator.clipboard.writeText(note).then(() => {
          toast('📋 笔记已复制到剪贴板（请先配置 Vault ⚙）');
        }).catch(() => {
          toast('⚠ 请点击 ⚙ 设置 Obsidian Vault');
        });
      }
    }, 300);

    resetUI();
  }

  function showSaveDialog() {
    if (!hasClip || !chunks.length) return;
    subtitleEl.value = '';
    dialog.classList.add('show');
    setTimeout(() => subtitleEl.focus(), 100);
  }

  dlgConfirm.addEventListener('click', () => {
    dialog.classList.remove('show');
    doSave(subtitleEl.value.trim());
  });

  // ── Save 按钮 ────────────────────────────────────────
  saveBtn.addEventListener('click', showSaveDialog);

  // ── 快捷键 [ ] ──────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.target.closest('input,textarea,[contenteditable]')) return;

    if (e.key === '[') {
      e.preventDefault();
      if (recorder && recorder.state === 'recording') return;
      if (hasClip) { toast('⚠ 请先 Save'); return; }
      startRecording();
    }

    if (e.key === ']') {
      e.preventDefault();
      if (!recorder || recorder.state !== 'recording') return;
      stopRecording();
    }
  });

  resetUI();
  log('🎵 Clipper v1.6 ready — [ 录制  ] 停止  Save → 字幕 → Obsidian');
})();
