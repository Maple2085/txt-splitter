#!/usr/bin/env node
/**
 * build.mjs —— 把 src/ 与 vendor/ 拼装成单文件 index.html
 *
 * 产物保持「一个 HTML 文件即可分发、离线可用」的特性，同时让源码可以正常编辑、
 * 搜索和做代码审查。
 *
 * 用法：
 *   node build.mjs            # 输出到 index.html
 *   node build.mjs out.html   # 输出到指定文件
 *   node build.mjs --check    # 只校验产物是否与磁盘上的 index.html 一致（CI 用）
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFile(join(root, rel), 'utf8');

/** 读取版本号：优先 package.json，否则从 CHANGELOG 的第一条正式版本取 */
async function readVersion() {
  try {
    const pkg = JSON.parse(await read('package.json'));
    if (pkg.version) return pkg.version;
  } catch {
    /* 没有 package.json 就继续 */
  }
  try {
    const changelog = await read('CHANGELOG.md');
    const m = changelog.match(/^##\s*\[(\d+\.\d+\.\d+)\]/m);
    if (m) return m[1];
  } catch {
    /* 忽略 */
  }
  return '0.0.0';
}

function normalize(value) {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd();
}

/** 缩进整段文本，让产物的格式保持一致 */
function indent(text, spaces) {
  const pad = ' '.repeat(spaces);
  return normalize(text)
    .split('\n')
    .map((line) => (line.length ? pad + line : line))
    .join('\n');
}

/**
 * 把 ESM 源码转成可内联的经典脚本。
 *
 * src/*.js 用 ESM 编写，这样 tests/ 可以直接 import 真实源码做单元测试；
 * 但单文件产物必须避免 import/export（file:// 下模块会有 MIME 与 CORS 限制）。
 * 内联时去掉 export 关键字与 import 语句，两个文件即处于同一作用域。
 */
function toInlineScript(source, { stripImports = false } = {}) {
  let out = normalize(source);
  if (stripImports) {
    out = out.replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  }
  out = out.replace(/^export\s+(const|let|var|function|async function|class)\b/gm, '$1');
  out = out.replace(/^export\s*\{[^}]*\};?\s*$/gm, '');
  if (/^\s*(import|export)\s/m.test(out)) {
    throw new Error('内联后仍残留 import / export 语句');
  }
  return out;
}

async function build() {
  const [template, styles, jszip, filesaver, splitCore, app, version] = await Promise.all([
    read('src/index.html'),
    read('src/styles.css'),
    read('vendor/jszip.min.js'),
    read('vendor/FileSaver.min.js'),
    read('src/split-core.js'),
    read('src/app.js'),
    readVersion(),
  ]);

  // 内联脚本里若出现 </script 会提前终止脚本块
  for (const [name, source] of [
    ['vendor/jszip.min.js', jszip],
    ['vendor/FileSaver.min.js', filesaver],
    ['src/split-core.js', splitCore],
    ['src/app.js', app],
  ]) {
    if (/<\/script/i.test(source)) {
      throw new Error(`${name} 含有 </script，需要转义后才能内联`);
    }
  }

  let html = normalize(template);

  // /* @inject:xxx */ 只替换注释体，保留外层缩进
  html = html.replace(/(\s*)\/\* @inject:styles \*\//, () => `\n${indent(styles, 8)}`);
  html = html.replace(/(\s*)\/\* @inject:vendor\/jszip \*\//, () => `\n${indent(jszip, 8)}`);
  html = html.replace(/(\s*)\/\* @inject:vendor\/filesaver \*\//, () => `\n${indent(filesaver, 8)}`);
  html = html.replace(
    /(\s*)\/\* @inject:app \*\//,
    () => `\n${indent(toInlineScript(splitCore, { stripImports: false }) + '\n\n' + toInlineScript(app, { stripImports: true }), 8)}`,
  );

  html = html.replace(/__VERSION__/g, version);

  if (/@inject:/.test(html)) {
    throw new Error('模板里还有没被替换的 @inject 占位符');
  }

  return html.endsWith('\n') ? html : `${html}\n`;
}

const args = process.argv.slice(2);
const checkMode = args.includes('--check');
const target = args.find((a) => !a.startsWith('--')) || 'index.html';

const output = await build();

if (checkMode) {
  let current = '';
  try {
    current = await read(target);
  } catch {
    console.error(`✗ ${target} 不存在，请先运行 node build.mjs`);
    process.exit(1);
  }
  if (normalize(current) === normalize(output)) {
    console.log(`✓ ${target} 与源码一致`);
  } else {
    console.error(`✗ ${target} 与源码不一致，请重新运行 node build.mjs`);
    process.exit(1);
  }
} else {
  await writeFile(join(root, target), output, 'utf8');
  const kb = (Buffer.byteLength(output, 'utf8') / 1024).toFixed(1);
  console.log(`✓ 已生成 ${target}（${kb} KB，v${await readVersion()}）`);
}
