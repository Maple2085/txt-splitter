/**
 * browser-check.mjs —— 在无头 Chrome 中真实加载构建产物并驱动界面
 *
 * 单元测试只能覆盖算法；这个脚本负责验证 DOM 装配、事件绑定、CSP、
 * 以及"构建产物在浏览器里真的能跑"。
 *
 * 用法：node tools/browser-check.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const PORT = 9333;
const results = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? '✔' : '✖'} ${name}${detail && !condition ? ` — ${detail}` : ''}`);
}

async function findChrome() {
  const { access } = await import('node:fs/promises');
  for (const path of CHROME_CANDIDATES) {
    try {
      await access(path);
      return path;
    } catch {
      /* 继续找 */
    }
  }
  return null;
}

async function waitForEndpoint(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`等待 ${url} 超时`);
}

/** 极简 CDP 客户端 */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.pageErrors = [];

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.pageErrors.push(d.exception?.description || d.text);
      }
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        this.consoleErrors.push(msg.params.entry.text);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} 超时`));
        }
      }, 60000);
    });
  }

  async evaluate(expression, awaitPromise = true) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }
}

async function main() {
  const chrome = await findChrome();
  if (!chrome) {
    console.log('未找到 Chrome / Edge，跳过浏览器检查');
    process.exit(0);
  }

  const profile = await mkdtemp(join(tmpdir(), 'txtsplit-'));
  const proc = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let exitCode = 0;
  try {
    const targets = await waitForEndpoint(`http://127.0.0.1:${PORT}/json/list`);
    const page = targets.find((t) => t.type === 'page');
    if (!page) throw new Error('找不到页面目标');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')), { once: true });
    });

    const cdp = new Cdp(ws);
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');

    const fileUrl = pathToFileURL(join(root, 'index.html')).href;
    await cdp.send('Page.navigate', { url: fileUrl });
    await new Promise((r) => setTimeout(r, 800));

    // ---- 页面基本结构 ----
    check('页面标题含版本号', (await cdp.evaluate('document.title')).includes('v2.5.0'));
    check('页面无 JS 异常', cdp.pageErrors.length === 0, cdp.pageErrors.join(' | '));

    const fnNames = await cdp.evaluate(
      `['computeChunkBoundaries','detectTextEncoding','readPreviewText','clampParts','formatBytes'].map(n => typeof window[n])`,
    );
    check('核心函数已暴露到全局', fnNames.every((t) => t === 'function'), JSON.stringify(fnNames));

    check('JSZip 已就绪', (await cdp.evaluate('typeof JSZip')) === 'function');
    check('FileSaver 已就绪', (await cdp.evaluate('typeof saveAs')) === 'function');

    // ---- CSP 未阻断内联脚本 ----
    const inlineRan = await cdp.evaluate(`document.querySelectorAll('.file-item').length >= 0 && typeof showToast === 'function'`);
    check('CSP 未阻断内联脚本（showToast 可用）', inlineRan);

    // ---- 空状态与初始可见性 ----
    check('结果区初始隐藏', (await cdp.evaluate(`document.getElementById('result-area').hidden`)) === true);
    check('文件信息初始隐藏', (await cdp.evaluate(`document.getElementById('file-info').hidden`)) === true);
    check('拖拽区可见', (await cdp.evaluate(`document.getElementById('upload-area').offsetHeight > 0`)) === true);

    // ---- 交互：Toast 连续 5 条不应冻结 ----
    const toastResult = await cdp.evaluate(`(() => {
      const container = document.getElementById('toast-container');
      container.textContent = '';
      for (let i = 0; i < 5; i++) showToast('测试消息 ' + i, i % 2 ? 'error' : 'info');
      const all = [...container.children];
      const active = all.filter(t => !t.classList.contains('toast-exit'));
      const exiting = all.length - active.length;
      // 等退场动画结束，确认节点被真正移除（而不是一直堆着）
      return new Promise(resolve => setTimeout(() => {
        resolve({ active: active.length, exiting, remaining: container.children.length });
      }, 500));
    })()`);
    check('连续 5 条 Toast 不冻结，同时最多 3 条', toastResult.active <= 3, JSON.stringify(toastResult));
    check('退场后的 Toast 被移除，不堆积', toastResult.remaining <= 3, JSON.stringify(toastResult));

    // 旧实现在这里会死循环，用超时兜底验证不会再发生
    const noHang = await cdp.evaluate(`(() => {
      const t0 = performance.now();
      for (let i = 0; i < 40; i++) showToast('压力测试 ' + i, 'error');
      return performance.now() - t0;
    })()`);
    check('连续 40 条 Toast 不会卡死主线程', noHang < 3000, `${Math.round(noHang)}ms`);
    await cdp.evaluate(`document.getElementById('toast-container').textContent = ''`);

    // ---- 交互：模式切换 ----
    await cdp.evaluate(`document.getElementById('mode-size').click()`);
    const sizeVisible = await cdp.evaluate(`!document.getElementById('size-group').hidden && document.getElementById('parts-group').hidden`);
    check('切换到按大小模式', sizeVisible);
    await cdp.evaluate(`document.getElementById('mode-parts').click()`);
    check(
      '切回按份数模式',
      await cdp.evaluate(`!document.getElementById('parts-group').hidden && document.getElementById('size-group').hidden`),
    );

    // ---- 端到端：构造 File 并走完整分割流程 ----
    const e2e = await cdp.evaluate(`(async () => {
      const line = '这是用于端到端测试的中文正文，模拟电子书排版，每行大约三十个汉字。\\n';
      const text = line.repeat(3000);              // 约 280KB
      const file = new File([text], '端到端 测试：小说.txt', { type: 'text/plain' });

      const input = document.getElementById('file-input');
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 400));

      const sizeText = document.getElementById('file-size-display').textContent;

      document.getElementById('parts-input').value = '7';
      document.getElementById('parts-input').dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 250));

      document.getElementById('split-btn').click();
      for (let i = 0; i < 100 && document.getElementById('split-btn').disabled; i++) {
        await new Promise(r => setTimeout(r, 100));
      }
      await new Promise(r => setTimeout(r, 200));

      const names = [...document.querySelectorAll('.file-item .file-link')].map(n => n.textContent);
      const sizes = [...document.querySelectorAll('.file-item .file-size-tag')].map(n => n.textContent);
      return {
        sizeText,
        estimate: document.getElementById('estimate').textContent,
        itemCount: names.length,
        names,
        sizes,
        noteHidden: document.getElementById('list-note').hidden,
        zipDisabled: document.getElementById('zip-btn').disabled,
        resultHidden: document.getElementById('result-area').hidden,
      };
    })()`);

    check('选择文件后显示编码', /UTF-8|GBK|ASCII/.test(e2e.sizeText), e2e.sizeText);
    check('估算显示 7 份', e2e.estimate.includes('7 份'), e2e.estimate);
    check('结果区已显示', e2e.resultHidden === false);
    check('渲染出 7 个条目', e2e.itemCount === 7, `实际 ${e2e.itemCount}`);
    check('打包按钮可用', e2e.zipDisabled === false);
    check(
      '文件名零填充正确（7 份不补零）',
      e2e.names[0] === 'P1_端到端 测试：小说.txt' && e2e.names[6] === 'P7_端到端 测试：小说.txt',
      JSON.stringify(e2e.names),
    );
    check('文件名保留合法的全角字符', e2e.names[0].includes('：'), JSON.stringify(e2e.names[0]));

    // ---- 文件名清洗：路径分隔符与 Windows 非法字符 ----
    const sanitize = await cdp.evaluate(`(async () => {
      const dt = new DataTransfer();
      dt.items.add(new File(['测试内容\\n'.repeat(50)], 'a\\\\b/c:d*e?f"g<h>i|j.txt', { type: 'text/plain' }));
      const input = document.getElementById('file-input');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 400));
      document.getElementById('parts-input').value = '2';
      document.getElementById('split-btn').click();
      for (let i = 0; i < 100 && document.getElementById('split-btn').disabled; i++) {
        await new Promise(r => setTimeout(r, 100));
      }
      await new Promise(r => setTimeout(r, 200));
      return [...document.querySelectorAll('.file-item .file-link')].map(n => n.textContent);
    })()`);
    check(
      'Windows 非法字符与路径分隔符被替换为下划线',
      sanitize[0] === 'P1_a_b_c_d_e_f_g_h_i_j.txt',
      JSON.stringify(sanitize),
    );

    // ---- 两位数的零填充（10 份 → P01 … P10） ----
    const padding = await cdp.evaluate(`(async () => {
      const dt = new DataTransfer();
      dt.items.add(new File(['填充测试正文内容。\\n'.repeat(400)], 'padding.txt', { type: 'text/plain' }));
      const input = document.getElementById('file-input');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 400));
      document.getElementById('parts-input').value = '12';
      document.getElementById('split-btn').click();
      for (let i = 0; i < 100 && document.getElementById('split-btn').disabled; i++) {
        await new Promise(r => setTimeout(r, 100));
      }
      await new Promise(r => setTimeout(r, 200));
      return [...document.querySelectorAll('.file-item .file-link')].map(n => n.textContent);
    })()`);
    check('12 份时补零到两位', padding[0] === 'P01_padding.txt' && padding[11] === 'P12_padding.txt', JSON.stringify(padding));

    // ---- 预览对话框（含点击遮罩关闭） ----
    const preview = await cdp.evaluate(`(async () => {
      document.querySelector('.file-item .preview-btn').click();
      await new Promise(r => setTimeout(r, 300));
      const dialog = document.getElementById('preview-dialog');
      const openAfterClick = dialog.open;
      const text = document.getElementById('preview-content').textContent;
      const focused = document.activeElement && document.activeElement.id;
      dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));  // 点在 dialog 自身上
      await new Promise(r => setTimeout(r, 150));
      return { openAfterClick, text, focused, openAfterBackdropClick: dialog.open };
    })()`);

    check('预览对话框可打开', preview.openAfterClick === true);
    check('预览内容非空且无乱码', preview.text.length > 20 && !preview.text.includes('�'), preview.text.slice(0, 40));
    check('打开后焦点落在关闭按钮', preview.focused === 'preview-close-btn', preview.focused);
    check('点击遮罩可关闭', preview.openAfterBackdropClick === false);

    // ---- 复制按钮（键盘/点击不冒泡触发下载） ----
    const copyResult = await cdp.evaluate(`(async () => {
      const li = document.querySelector('.file-item');
      let downloaded = false;
      const origSave = window.saveAs;
      window.saveAs = () => { downloaded = true; };
      li.querySelector('.copy-btn').click();
      await new Promise(r => setTimeout(r, 200));
      window.saveAs = origSave;
      return { downloaded, liCount: document.querySelectorAll('.file-item').length };
    })()`);
    check('点击复制不会触发下载', copyResult.downloaded === false);

    // ---- 输入校验 ----
    const validation = await cdp.evaluate(`(async () => {
      const input = document.getElementById('parts-input');
      input.value = '0';
      document.getElementById('split-btn').click();
      await new Promise(r => setTimeout(r, 100));
      const invalid = input.getAttribute('aria-invalid');
      const msg = document.getElementById('parts-hint').textContent;
      input.value = '5';
      document.getElementById('split-btn').click();
      for (let i = 0; i < 100 && document.getElementById('split-btn').disabled; i++) {
        await new Promise(r => setTimeout(r, 100));
      }
      await new Promise(r => setTimeout(r, 300));
      const hintAfterFix = document.getElementById('parts-hint').textContent;
      const ariaAfterFix = input.getAttribute('aria-invalid');
      return { invalid, msg, hintAfterFix, ariaAfterFix };
    })()`);
    check('0 份被拒绝并标记 aria-invalid', validation.invalid === 'true' && validation.msg.includes('大于 0'), JSON.stringify(validation));
    check('修正后提示文案恢复默认', validation.hintAfterFix.includes('1-5000'), validation.hintAfterFix);
    check('修正后 aria-invalid 复位', validation.ariaAfterFix === 'false');

    // ---- 处理中锁定输入 ----
    const lockCheck = await cdp.evaluate(`(async () => {
      document.getElementById('parts-input').value = '500';
      document.getElementById('split-btn').click();
      await new Promise(r => setTimeout(r, 60));
      const during = {
        inputDisabled: document.getElementById('parts-input').disabled,
        modeDisabled: document.getElementById('mode-parts').disabled,
        cancelVisible: !document.getElementById('cancel-btn').hidden,
      };
      document.getElementById('cancel-btn').click();
      for (let i = 0; i < 100 && document.getElementById('split-btn').disabled; i++) {
        await new Promise(r => setTimeout(r, 100));
      }
      await new Promise(r => setTimeout(r, 200));
      return {
        during,
        after: {
          inputDisabled: document.getElementById('parts-input').disabled,
          resultHidden: document.getElementById('result-area').hidden,
          zipDisabled: document.getElementById('zip-btn').disabled,
        },
      };
    })()`);
    check('处理中输入被锁定', lockCheck.during.inputDisabled === true && lockCheck.during.modeDisabled === true);
    check('处理中显示停止按钮', lockCheck.during.cancelVisible === true);
    check('取消后解锁输入', lockCheck.after.inputDisabled === false);
    check('取消后结果区隐藏', lockCheck.after.resultHidden === true);
    check('取消后打包按钮禁用', lockCheck.after.zipDisabled === true);

    // ---- 空文件与错误格式 ----
    const rejects = await cdp.evaluate(`(async () => {
      const dt = new DataTransfer();
      dt.items.add(new File([], '空文件.txt', { type: 'text/plain' }));
      const input = document.getElementById('file-input');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      const emptyToast = [...document.querySelectorAll('.toast')].map(t => t.textContent).join('|');
      return { emptyToast };
    })()`);
    check('空文件被拒绝并提示', rejects.emptyToast.includes('空'), rejects.emptyToast);

    // ---- 打包下载 ----
    const zipResult = await cdp.evaluate(`(async () => {
      const line = '打包测试正文内容，重复若干行以产生足够的体积。\\n';
      const file = new File([line.repeat(500)], '打包测试.txt', { type: 'text/plain' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.getElementById('file-input');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 400));
      document.getElementById('parts-input').value = '4';
      document.getElementById('split-btn').click();
      for (let i = 0; i < 100 && document.getElementById('split-btn').disabled; i++) {
        await new Promise(r => setTimeout(r, 100));
      }
      await new Promise(r => setTimeout(r, 200));

      let savedName = null;
      const orig = window.saveAs;
      window.saveAs = (blob, name) => { savedName = name; window.__zipBlob = blob; };
      document.getElementById('zip-btn').click();
      for (let i = 0; i < 100 && document.getElementById('zip-btn').disabled; i++) {
        await new Promise(r => setTimeout(r, 100));
      }
      await new Promise(r => setTimeout(r, 200));
      const size = window.__zipBlob ? window.__zipBlob.size : 0;
      const type = window.__zipBlob ? window.__zipBlob.type : '';
      window.saveAs = orig;
      return { savedName, size, type };
    })()`);
    check('ZIP 文件名正确', zipResult.savedName === '打包测试_分割结果.zip', zipResult.savedName);
    check('ZIP 内容非空', zipResult.size > 0, `size=${zipResult.size}`);

    // ---- 深色模式 ----
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    const darkOk = await cdp.evaluate(`(() => {
      const bg = getComputedStyle(document.querySelector('.container')).backgroundColor;
      const text = getComputedStyle(document.getElementById('app-title')).color;
      return { bg, text };
    })()`);
    check('深色模式生效', darkOk.bg !== 'rgb(255, 255, 255)' && darkOk.bg !== 'rgba(255, 255, 255, 0.96)', JSON.stringify(darkOk));
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });

    // ---- 减少动效 ----
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const motionOk = await cdp.evaluate(`getComputedStyle(document.querySelector('.container')).opacity`);
    check('减少动效下容器不透明', motionOk === '1', `opacity=${motionOk}`);
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });

    // ---- 回归：依赖入场动画的元素在动画结束后必须真的可见 ----
    const visibility = await cdp.evaluate(`(async () => {
      await new Promise(r => setTimeout(r, 1200));   // 等所有入场动画跑完
      const op = (sel) => {
        const node = document.querySelector(sel);
        return node ? getComputedStyle(node).opacity : null;
      };
      const rect = document.getElementById('result-area').getBoundingClientRect();
      return {
        resultArea: op('#result-area'),
        resultHeight: Math.round(rect.height),
        fileItem: op('.file-item'),
        optionGroup: op('.option-group'),
        estimateBar: op('.estimate-bar'),
        modeSwitch: op('.mode-switch'),
        header: op('header'),
        container: op('.container'),
        inputGroup: op('.input-group:not([hidden])'),
        zipBtnHeight: document.getElementById('zip-btn').getBoundingClientRect().height,
      };
    })()`);

    const opaque = (v) => v === '1';
    check('结果区动画结束后完全可见', opaque(visibility.resultArea) && visibility.resultHeight > 0, JSON.stringify(visibility));
    check('列表项动画结束后可见', opaque(visibility.fileItem), visibility.fileItem);
    check('切分偏好区可见', opaque(visibility.optionGroup), visibility.optionGroup);
    check('估算条可见', opaque(visibility.estimateBar), visibility.estimateBar);
    check('模式切换区可见', opaque(visibility.modeSwitch), visibility.modeSwitch);
    check('页头可见', opaque(visibility.header), visibility.header);
    check('容器可见', opaque(visibility.container), visibility.container);
    check('输入组可见', opaque(visibility.inputGroup), visibility.inputGroup);
    check('打包按钮有实际高度', visibility.zipBtnHeight > 0, String(visibility.zipBtnHeight));

    // ---- 无控制台错误 ----
    check('运行期无控制台错误', cdp.consoleErrors.length === 0, cdp.consoleErrors.slice(0, 3).join(' | '));

    // ---- 回归：改造成 <button> 的元素必须已清除浏览器默认外观 ----
    const buttonLooks = await cdp.evaluate(`(() => {
      const link = document.querySelector('.file-link');
      const s = getComputedStyle(link);
      const title = document.querySelector('.upload-title');
      const ts = getComputedStyle(title);
      const desc = getComputedStyle(document.getElementById('upload-desc'));
      return {
        linkBg: s.backgroundColor,
        linkBorder: s.borderTopWidth,
        linkAlign: s.textAlign,
        titleColor: ts.color,
        descColor: desc.color,
        titleSize: ts.fontSize,
        fileInputHidden: document.getElementById('file-input').hidden,
        nested: !!document.querySelector('[role="button"] input:not([hidden])'),
      };
    })()`);
    check(
      '文件名按钮无默认底色/边框',
      buttonLooks.linkBg === 'rgba(0, 0, 0, 0)' || buttonLooks.linkBg === 'transparent',
      buttonLooks.linkBg,
    );
    check('文件名按钮无默认边框', buttonLooks.linkBorder === '0px', buttonLooks.linkBorder);
    check('文件名按钮左对齐', buttonLooks.linkAlign === 'left', buttonLooks.linkAlign);
    check(
      '上传区标题比描述文字更深、更大（特异性正确）',
      buttonLooks.titleColor !== buttonLooks.descColor && parseFloat(buttonLooks.titleSize) > 14,
      JSON.stringify(buttonLooks),
    );
    check('上传区内无嵌套可聚焦控件', buttonLooks.nested === false);

    ws.close();
  } catch (err) {
    console.error('浏览器检查失败:', err.message);
    exitCode = 1;
  } finally {
    proc.kill();
    await new Promise((r) => setTimeout(r, 300));
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n共 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  if (failed.length) {
    console.log('失败项：');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    exitCode = 1;
  }
  process.exit(exitCode);
}

main();
