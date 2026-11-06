/**
 * app.js —— 界面逻辑
 *
 * 状态集中在 state 里；分割所需的文件、模式、参数在开始时一次性快照成局部变量，
 * 处理过程中不再读取全局状态，因此中途切换模式或换文件都不会污染正在进行的任务。
 */

import {
  MAX_PARTS,
  BREAK_PREFERENCE,
  detectTextEncoding,
  computeChunkBoundaries,
  clampParts,
  estimatePartsBySize,
  readPreviewText,
} from './split-core.js';

/* ------------------------------------------------------------------ *
 * 状态
 * ------------------------------------------------------------------ */

const state = {
  file: null,
  encoding: null,
  mode: 'parts',
  preference: BREAK_PREFERENCE.auto,
  chunks: [],
  busy: false,
  abort: null,
  previewTrigger: null,
};

const MAX_TOASTS = 3;
const PREVIEW_CHARS = 1000;
/** 超过这个份数就不逐项建 DOM，改为分页渲染 */
const RENDER_PAGE_SIZE = 200;

const el = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** 文件名清洗：去掉路径分隔符和 Windows 非法字符，避免解压失败 */
function sanitizeBaseName(name) {
  return (
    String(name)
      .replace(/\.txt$/i, '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 120) || 'text'
  );
}

/* ------------------------------------------------------------------ *
 * Toast：aria-live 在常驻容器上，节点只做追加
 * ------------------------------------------------------------------ */

function removeToast(toast) {
  if (!toast || toast.classList.contains('toast-exit')) return;
  if (toast._dismissTimer) clearTimeout(toast._dismissTimer);
  toast.classList.add('toast-exit');
  toast._exitTimer = setTimeout(() => toast.remove(), 300);
}

function showToast(message, type = 'info') {
  const container = el('toast-container');

  // 只统计尚未进入退出动画的通知；removeToast 是异步移除，不能直接看 children.length
  const active = [...container.children].filter((t) => !t.classList.contains('toast-exit'));
  while (active.length >= MAX_TOASTS) removeToast(active.shift());

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  // 错误用 assertive，其余用容器上的 polite
  if (type === 'error') toast.setAttribute('role', 'alert');

  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  const iconSpan = document.createElement('span');
  iconSpan.setAttribute('aria-hidden', 'true');
  iconSpan.textContent = icon;
  toast.append(iconSpan, ' ', message);

  container.appendChild(toast);
  toast._dismissTimer = setTimeout(() => removeToast(toast), 3500);
}

/* ------------------------------------------------------------------ *
 * 输入校验
 * ------------------------------------------------------------------ */

function setHintState(inputId, hintId, message) {
  const input = el(inputId);
  const hint = el(hintId);
  if (message) {
    input.classList.add('error');
    input.setAttribute('aria-invalid', 'true');
    hint.textContent = message;
    hint.classList.add('error-text');
  } else {
    input.classList.remove('error');
    input.setAttribute('aria-invalid', 'false');
    hint.textContent = hint.dataset.default || '';
    hint.classList.remove('error-text');
  }
}

function clearInputErrors() {
  setHintState('parts-input', 'parts-hint', null);
  setHintState('size-input', 'size-hint', null);
}

function showInputError(inputId, hintId, message) {
  setHintState(inputId, hintId, message);
  el(inputId).focus();
}

/**
 * 读取并校验当前输入。
 * @param {{quiet?: boolean}} options quiet 时不改动 DOM（供防抖估算使用，避免抢焦点）
 * @returns {{partsCount:number, maxChunkBytes:number}|null} null 表示校验失败
 */
function readParams({ quiet = false } = {}) {
  const fail = (inputId, hintId, message) => {
    if (!quiet) showInputError(inputId, hintId, message);
    return null;
  };

  if (state.mode === 'parts') {
    const raw = el('parts-input').value.trim();
    const n = Number(raw);
    if (raw === '' || !Number.isInteger(n) || n <= 0) {
      return fail('parts-input', 'parts-hint', '请输入大于 0 的整数');
    }
    if (n > MAX_PARTS) {
      return fail('parts-input', 'parts-hint', `最大支持 ${MAX_PARTS} 份`);
    }
    return { partsCount: clampParts(state.file ? state.file.size : n, n), maxChunkBytes: Infinity };
  }

  const raw = el('size-input').value.trim();
  const mb = Number(raw);
  if (raw === '' || !Number.isFinite(mb) || mb < 0.01) {
    return fail('size-input', 'size-hint', '每份文件大小不能小于 0.01 MB');
  }
  const maxChunkBytes = Math.max(1, Math.floor(mb * 1024 * 1024));
  const partsCount = state.file ? estimatePartsBySize(state.file.size, maxChunkBytes) : 1;
  if (partsCount > MAX_PARTS) {
    return fail('size-input', 'size-hint', `会产生 ${partsCount} 份，超出 ${MAX_PARTS} 份上限，请调大每份大小`);
  }
  return { partsCount, maxChunkBytes };
}

/* ------------------------------------------------------------------ *
 * 估算
 * ------------------------------------------------------------------ */

function updateEstimate() {
  const est = el('estimate');
  est.classList.remove('is-error');

  if (!state.file) {
    est.textContent = '';
    est.classList.remove('has-file');
    return;
  }

  // 防抖估算只读数值，不写错误状态，避免打字过程被抢焦点
  const params = readParams({ quiet: true });
  if (!params) {
    est.textContent = '参数有误，请检查输入';
    est.classList.add('has-file', 'is-error');
    return;
  }

  const avg = state.file.size / params.partsCount;
  const enc = state.encoding ? ` · ${state.encoding.label}` : '';
  est.textContent = `预估 ${params.partsCount} 份 · 每份约 ${formatBytes(avg)}${enc}`;
  est.classList.add('has-file');
}

/* ------------------------------------------------------------------ *
 * 文件选择
 * ------------------------------------------------------------------ */

async function handleFile(file) {
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.txt')) {
    showToast('格式不支持，请上传标准的 .txt 文本文件', 'error');
    return;
  }
  if (file.size === 0) {
    showToast('这个文件是空的（0 字节），没有内容可以分割', 'error');
    return;
  }

  // 编码探测是异步的：连续快速选择文件时，先发起的探测可能后返回并覆盖结果。
  // 用一个自增令牌，只接受仍然是"当前这次选择"的结果。
  const token = ++loadToken;
  state.file = file;
  state.encoding = null;
  state.chunks = [];

  el('result-area').hidden = true;
  el('file-list').textContent = '';

  const info = el('file-info');
  info.hidden = false;
  el('file-name-display').textContent = file.name;
  el('file-size-display').textContent = `${formatBytes(file.size)} · 正在识别编码…`;

  // 重新触发入场动画
  info.style.animation = 'none';
  void info.offsetHeight;
  info.style.animation = '';

  let encoding;
  try {
    encoding = await detectTextEncoding(file);
  } catch {
    encoding = { name: 'utf-8', bom: 0, unit: 1, charAlign: true, label: 'UTF-8' };
  }

  if (token !== loadToken) return; // 期间又选了别的文件，丢弃这次结果

  state.encoding = encoding;
  el('file-size-display').textContent = `${formatBytes(file.size)} · ${encoding.label}`;
  updateEstimate();
}

function clearFile() {
  loadToken += 1; // 使仍在进行中的编码探测失效
  state.file = null;
  state.encoding = null;
  state.chunks = [];
  el('file-info').hidden = true;
  el('result-area').hidden = true;
  el('file-list').textContent = '';
  el('file-input').value = '';
  el('estimate').textContent = '';
  el('estimate').classList.remove('has-file', 'is-error');
  clearInputErrors();
}

/* ------------------------------------------------------------------ *
 * 模式切换
 * ------------------------------------------------------------------ */

const MODE_TABS = ['mode-parts', 'mode-size'];

function toggleMode(mode) {
  state.mode = mode;
  const isParts = mode === 'parts';

  el('mode-parts').classList.toggle('active', isParts);
  el('mode-parts').setAttribute('aria-selected', String(isParts));
  el('mode-parts').tabIndex = isParts ? 0 : -1;
  el('mode-size').classList.toggle('active', !isParts);
  el('mode-size').setAttribute('aria-selected', String(!isParts));
  el('mode-size').tabIndex = isParts ? -1 : 0;

  el('parts-group').hidden = !isParts;
  el('size-group').hidden = isParts;

  clearInputErrors();
  updateEstimate();
}

/* ------------------------------------------------------------------ *
 * 分割
 * ------------------------------------------------------------------ */

function setBusy(busy) {
  state.busy = busy;
  el('split-btn').disabled = busy;
  el('zip-btn').disabled = busy || state.chunks.length === 0;
  el('cancel-btn').hidden = !busy;
  // 处理期间锁住输入，避免中途改动污染当前任务
  el('upload-area').setAttribute('aria-disabled', String(busy));
  el('upload-area').tabIndex = busy ? -1 : 0;
  for (const id of ['parts-input', 'size-input', 'mode-parts', 'mode-size', 'clear-file-btn', 'file-input']) {
    const node = el(id);
    if (node) node.disabled = busy;
  }
  document.querySelectorAll('input[name="break-mode"]').forEach((r) => {
    r.disabled = busy;
  });
}

function setProgress(ratio, text) {
  const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  const container = el('split-progress');
  container.hidden = false;
  el('split-progress-bar').style.width = `${pct}%`;
  container.setAttribute('aria-valuenow', String(pct));
  el('progress-text').textContent = text || `正在分割... ${pct}%`;
}

async function processSplit() {
  if (state.busy) return;
  if (!state.file) {
    showToast('请先选择文件', 'error');
    return;
  }

  clearInputErrors();
  const params = readParams();
  if (!params) return;

  // 快照：循环里只用这些局部值
  const file = state.file;
  const mode = state.mode;
  const preference = state.preference;
  const encoding = state.encoding;

  setBusy(true);
  const splitBtn = el('split-btn');
  splitBtn.innerHTML = '<span class="loader" aria-hidden="true"></span> 处理中...';

  const listEl = el('file-list');
  listEl.textContent = '';
  listEl.hidden = true;
  el('list-note').hidden = true;
  el('result-area').hidden = false;
  el('skeleton-list').hidden = false;
  setProgress(0, '正在分析文件...');

  const controller = new AbortController();
  state.abort = controller;
  let cancelled = false;

  try {
    const boundaries = await computeChunkBoundaries(file, {
      mode,
      parts: params.partsCount,
      maxBytes: params.maxChunkBytes,
      encoding,
      preference,
      onProgress: ({ ratio, index, total }) => {
        if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError');
        setProgress(ratio, `正在分割... ${index}/${total}`);
      },
    });

    if (controller.signal.aborted) {
      cancelled = true;
    } else {
      // 命名延后到循环结束，按实际生成数量决定零填充宽度
      const padWidth = String(boundaries.length).length;
      const baseName = sanitizeBaseName(file.name);
      state.chunks = boundaries.map(([start, end], idx) => ({
        blob: file.slice(start, end),
        name: `P${String(idx + 1).padStart(padWidth, '0')}_${baseName}.txt`,
      }));
      setProgress(1, '分割完成');
    }
  } catch (err) {
    if (err && err.name === 'AbortError') {
      cancelled = true;
    } else {
      state.chunks = [];
      el('result-area').hidden = true;
      showToast(`分割失败：${err.message || '无法读取文件'}`, 'error');
    }
  } finally {
    state.abort = null;
    setBusy(false);
    splitBtn.innerHTML = '<span aria-hidden="true">⚡</span> 立即开始分割';
    el('split-progress').hidden = true;
    el('skeleton-list').hidden = true;
    el('cancel-btn').hidden = true;
  }

  if (cancelled) {
    state.chunks = [];
    el('result-area').hidden = true;
    el('zip-btn').disabled = true;
    showToast('已取消分割', 'info');
    return;
  }

  if (state.chunks.length === 0) {
    el('result-area').hidden = true;
    return;
  }

  listEl.hidden = false;
  renderChunks();
  showToast(`分割完成！共生成 ${state.chunks.length} 个文件`, 'success');
}

/* ------------------------------------------------------------------ *
 * 结果渲染：DocumentFragment + 事件委托 + 分页
 * ------------------------------------------------------------------ */

let renderedCount = 0;
/** 编码探测的令牌，用于丢弃过期的异步结果 */
let loadToken = 0;

function createRow(chunk, index) {
  const li = document.createElement('li');
  li.className = 'file-item';
  li.dataset.index = String(index);
  li.style.animationDelay = `${Math.min(renderedCount, 20) * 0.03}s`;

  const row = document.createElement('div');
  row.className = 'file-main-row';

  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'file-link';
  link.textContent = chunk.name;
  link.setAttribute('aria-label', `下载 ${chunk.name}，大小 ${formatBytes(chunk.blob.size)}`);

  const actions = document.createElement('div');
  actions.className = 'action-btns';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'mini-btn copy-btn';
  copyBtn.dataset.action = 'copy';
  copyBtn.setAttribute('aria-label', `复制文件名 ${chunk.name}`);
  copyBtn.innerHTML = '<span aria-hidden="true">📋</span> 复制';

  const previewBtn = document.createElement('button');
  previewBtn.type = 'button';
  previewBtn.className = 'mini-btn preview-btn';
  previewBtn.dataset.action = 'preview';
  previewBtn.setAttribute('aria-label', `预览 ${chunk.name} 内容`);
  previewBtn.innerHTML = '<span aria-hidden="true">🔍</span> 预览';

  const sizeTag = document.createElement('span');
  sizeTag.className = 'file-size-tag';
  sizeTag.textContent = formatBytes(chunk.blob.size);

  actions.append(copyBtn, previewBtn, sizeTag);
  row.append(link, actions);
  li.appendChild(row);
  renderedCount += 1;
  return li;
}

function renderChunks({ append = false } = {}) {
  const listEl = el('file-list');
  if (!append) {
    listEl.textContent = '';
    renderedCount = 0;
  }

  const from = renderedCount;
  const limit = Math.min(state.chunks.length, RENDER_PAGE_SIZE);
  const to = append ? Math.min(state.chunks.length, from + RENDER_PAGE_SIZE) : limit;

  const fragment = document.createDocumentFragment();
  for (let i = from; i < to; i++) fragment.appendChild(createRow(state.chunks[i], i));
  listEl.appendChild(fragment);

  const note = el('list-note');
  note.textContent = '';

  if (to < state.chunks.length) {
    const remaining = state.chunks.length - to;
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'mini-btn more-btn';
    more.textContent = `展开剩余 ${remaining} 项`;
    more.onclick = () => {
      const scrollTop = listEl.scrollTop;
      renderChunks({ append: true });
      listEl.scrollTop = scrollTop; // 保持滚动位置，不要跳回顶部
    };
    note.append(`已显示 ${to} / ${state.chunks.length} 项。`, more);
    note.hidden = false;
  } else if (append) {
    note.hidden = true;
  } else {
    note.hidden = true;
  }
}

function chunkFromEvent(event) {
  const li = event.target.closest('.file-item');
  if (!li) return null;
  const index = Number(li.dataset.index);
  const chunk = state.chunks[index];
  return chunk ? { chunk, li } : null;
}

/* ------------------------------------------------------------------ *
 * 下载 / 复制 / 预览
 * ------------------------------------------------------------------ */

function downloadChunk(chunk) {
  // FileSaver 已内联，对 Safari / iOS 的处理比手写的 200ms revoke 更稳妥
  if (typeof saveAs === 'function') {
    saveAs(chunk.blob, chunk.name);
  } else {
    const url = URL.createObjectURL(chunk.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = chunk.name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 30000);
  }
}

async function copyName(name, btn) {
  const original = btn.innerHTML;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(name);
    } else {
      // 老 WebView 回退
      const ta = document.createElement('textarea');
      ta.value = name;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      ta.remove();
      if (!ok) throw new Error('execCommand 复制失败');
    }
    btn.classList.add('copied');
    btn.innerHTML = '<span aria-hidden="true">✅</span> 已复制';
    showToast('文件名已复制', 'success');
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = original;
    }, 2000);
  } catch {
    showToast('复制失败，请手动选中文件名复制', 'error');
  }
}

async function showPreview(chunk, triggerEl) {
  state.previewTrigger = triggerEl;
  const dialog = el('preview-dialog');
  try {
    const text = await readPreviewText(chunk.blob, state.encoding ? state.encoding.name : 'utf-8', PREVIEW_CHARS);
    el('preview-content').textContent = text + '\n\n... (仅展示前 1000 个字符)';
  } catch (err) {
    el('preview-content').textContent = `无法预览这个文件：${err.message || '读取失败'}`;
    showToast('预览失败，可能是文件已被移动或浏览器限制读取', 'error');
  }

  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
    el('preview-close-btn').focus();
  } else {
    // 老 WebView 没有 <dialog>
    window.alert(el('preview-content').textContent);
  }
}

function closePreview() {
  const dialog = el('preview-dialog');
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
}

/* ------------------------------------------------------------------ *
 * 打包下载
 * ------------------------------------------------------------------ */

async function downloadZip() {
  if (state.busy) return;
  if (state.chunks.length === 0) {
    showToast('请先分割文件', 'error');
    return;
  }
  if (typeof JSZip === 'undefined' || typeof saveAs === 'undefined') {
    showToast('打包组件未加载，请重新打开页面', 'error');
    return;
  }

  const file = state.file;
  const zipBtn = el('zip-btn');
  const originalHtml = zipBtn.innerHTML;
  zipBtn.disabled = true;
  zipBtn.innerHTML = '<span class="loader" aria-hidden="true"></span> 打包中...';

  const wrap = el('zip-progress');
  wrap.hidden = false;

  try {
    const zip = new JSZip();
    for (const chunk of state.chunks) zip.file(chunk.name, chunk.blob);

    const content = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      (meta) => {
        const pct = Math.round(meta.percent);
        el('zip-progress-bar').style.width = `${pct}%`;
        wrap.setAttribute('aria-valuenow', String(pct));
        el('zip-progress-text').textContent = `正在打包... ${pct}%`;
      },
    );

    saveAs(content, `${sanitizeBaseName(file ? file.name : 'text')}_分割结果.zip`);
    showToast('打包成功，开始下载', 'success');
  } catch (err) {
    showToast(`打包失败：${err.message || '未知错误'}`, 'error');
  } finally {
    zipBtn.disabled = false;
    zipBtn.innerHTML = originalHtml;
    wrap.hidden = true;
    el('zip-progress-bar').style.width = '0%';
  }
}

/* ------------------------------------------------------------------ *
 * 初始化
 * ------------------------------------------------------------------ */

function init() {
  const uploadArea = el('upload-area');
  const fileInput = el('file-input');

  el('mode-parts').onclick = () => toggleMode('parts');
  el('mode-size').onclick = () => toggleMode('size');

  // Tab 方向键切换
  MODE_TABS.forEach((id, i) => {
    el(id).addEventListener('keydown', (e) => {
      let next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % MODE_TABS.length;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + MODE_TABS.length) % MODE_TABS.length;
      if (e.key === 'Home') next = 0;
      if (e.key === 'End') next = MODE_TABS.length - 1;
      if (next === null) return;
      e.preventDefault();
      const target = el(MODE_TABS[next]);
      target.focus();
      toggleMode(next === 0 ? 'parts' : 'size');
    });
  });

  uploadArea.onclick = () => {
    if (!state.busy) fileInput.click();
  };
  uploadArea.addEventListener('keydown', (e) => {
    if (state.busy) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // 允许再次选择同一个文件
    handleFile(file);
  };

  // 拖拽
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((name) => {
    document.body.addEventListener(name, (e) => e.preventDefault(), false);
  });
  uploadArea.ondragenter = (e) => {
    e.preventDefault();
    if (!state.busy) uploadArea.classList.add('dragover');
  };
  uploadArea.ondragover = (e) => {
    e.preventDefault();
    if (!state.busy) uploadArea.classList.add('dragover');
  };
  uploadArea.ondragleave = (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
  };
  uploadArea.ondrop = (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (state.busy) return;
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    if (files.length > 1) showToast('一次只能处理一个文件，已使用第一个', 'info');
    handleFile(files[0]);
  };

  el('clear-file-btn').onclick = clearFile;
  el('split-btn').onclick = processSplit;
  el('zip-btn').onclick = downloadZip;
  el('cancel-btn').onclick = () => {
    if (state.abort) state.abort.abort();
  };

  el('parts-input').addEventListener('input', debounce(updateEstimate, 150));
  el('size-input').addEventListener('input', debounce(updateEstimate, 150));

  document.querySelectorAll('input[name="break-mode"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      if (e.target.checked) {
        state.preference = e.target.value;
        updateEstimate();
      }
    });
  });

  // 结果列表：事件委托，避免上千个监听器
  const listEl = el('file-list');
  listEl.addEventListener('click', (e) => {
    const hit = chunkFromEvent(e);
    if (!hit) return;
    const action = e.target.closest('[data-action]');
    if (action) {
      e.stopPropagation();
      if (action.dataset.action === 'copy') copyName(hit.chunk.name, action);
      else showPreview(hit.chunk, action);
      return;
    }
    if (e.target.closest('.file-link')) downloadChunk(hit.chunk);
  });

  // <dialog> 原生支持 ESC；统一在 close 事件里归还焦点
  const dialog = el('preview-dialog');
  dialog.addEventListener('close', () => {
    const trigger = state.previewTrigger;
    if (trigger && document.body.contains(trigger)) trigger.focus();
    state.previewTrigger = null;
  });
  el('preview-close-btn').addEventListener('click', closePreview);
  // 点击遮罩关闭
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closePreview();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
