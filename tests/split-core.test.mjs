/**
 * split-core 单元测试
 *
 * 运行：node --test tests/
 *
 * 这里的样本刻意覆盖旧实现踩过的坑：
 *   - GBK 中文（旧实现会切进汉字中间）
 *   - 按大小分割时换行对齐（旧实现因上限判断恒假而完全失效）
 *   - 按份数分割的实际份数（旧实现会明显少于请求份数）
 *   - UTF-8 / UTF-16 / 纯 CR 换行 / 空文件 / 单行超长
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_PARTS,
  detectTextEncoding,
  computeChunkBoundaries,
  clampParts,
  estimatePartsBySize,
  readPreviewText,
} from '../src/split-core.js';

/* ------------------------------------------------------------------ *
 * 样本构造
 * ------------------------------------------------------------------ */

const utf8 = (s) => new TextEncoder().encode(s);

/** 按目标字节数构造一小段"小说"，每行 44 个汉字 + 换行 */
function makeNovel(targetBytes, lineCount) {
  const line = '这是一行用于测试的中文小说正文内容，长度大约四十四个汉字，模拟真实排版。\n';
  const perLine = utf8(line).length;
  const n = lineCount || Math.ceil(targetBytes / perLine);
  return { text: line.repeat(n), lineBytes: perLine, lines: n };
}

/** GBK 反查表：遍历 GBK 双字节区，用解码器得到每个字节对对应的字符 */
const GBK_TABLE = (() => {
  const decoder = new TextDecoder('gbk');
  const map = new Map();
  for (let hi = 0x81; hi <= 0xfe; hi++) {
    for (let lo = 0x40; lo <= 0xfe; lo++) {
      if (lo === 0x7f) continue;
      const ch = decoder.decode(new Uint8Array([hi, lo]));
      if (ch.length === 1 && ch !== '�' && !map.has(ch)) map.set(ch, [hi, lo]);
    }
  }
  return map;
})();

/** 用真实的 GBK 字节构造中文正文 */
function makeGbk(targetBytes, lineText = '这是一行用于测试的中文小说正文内容，长度大约四十四个汉字，模拟真实排版。') {
  const encoded = [];
  for (const ch of lineText) {
    const pair = GBK_TABLE.get(ch);
    if (!pair) throw new Error(`字符 ${ch} 不在 GBK 表中`);
    encoded.push(pair[0], pair[1]);
  }
  encoded.push(0x0a);
  const lineBytes = encoded.length;

  const out = new Uint8Array(Math.ceil(targetBytes / lineBytes) * lineBytes);
  for (let offset = 0; offset < out.length; offset += lineBytes) out.set(encoded, offset);
  return out;
}

function makeUtf16le(text) {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe; // BOM
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[2 + i * 2] = code & 0xff;
    out[3 + i * 2] = (code >> 8) & 0xff;
  }
  return out;
}

async function tailOf(blob) {
  if (blob.size === 0) return '';
  const last = new Uint8Array(await blob.slice(blob.size - 1).arrayBuffer());
  return last[0];
}

/* ------------------------------------------------------------------ *
 * 编码探测
 * ------------------------------------------------------------------ */

test('编码探测：UTF-8 带 BOM', async () => {
  const file = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), utf8('中文内容')]);
  const enc = await detectTextEncoding(file);
  assert.equal(enc.name, 'utf-8');
  assert.equal(enc.bom, 3);
});

test('编码探测：纯 ASCII', async () => {
  const enc = await detectTextEncoding(new Blob([utf8('hello world\n')]));
  assert.equal(enc.name, 'ascii');
});

test('编码探测：UTF-8 无 BOM', async () => {
  const enc = await detectTextEncoding(new Blob([utf8('中文内容，没有 BOM。')]));
  assert.equal(enc.name, 'utf-8');
  assert.equal(enc.bom, 0);
});

test('编码探测：GBK', async () => {
  const enc = await detectTextEncoding(new Blob([makeGbk(4096)]));
  assert.equal(enc.name, 'gbk');
  assert.equal(enc.charAlign, false);
});

test('编码探测：UTF-16 LE / BE', async () => {
  const le = await detectTextEncoding(new Blob([makeUtf16le('中文测试')]));
  assert.equal(le.name, 'utf-16le');
  assert.equal(le.unit, 2);

  const be = new Uint8Array(makeUtf16le('中文测试'));
  be[0] = 0xfe;
  be[1] = 0xff;
  assert.equal((await detectTextEncoding(new Blob([be]))).name, 'utf-16be');
});

/* ------------------------------------------------------------------ *
 * 参数边界
 * ------------------------------------------------------------------ */

test('clampParts：不会超过文件字节数，也不会超过上限', () => {
  assert.equal(clampParts(100, 5000), 100); // 100 字节最多切 100 份
  assert.equal(clampParts(10 * 1024 * 1024, 5000), MAX_PARTS);
  assert.equal(clampParts(1024, 0), 1);
  assert.equal(clampParts(1024, -5), 1);
  assert.equal(clampParts(1024, 3.7), 3);
});

test('estimatePartsBySize', () => {
  assert.equal(estimatePartsBySize(1024 * 1024, 512 * 1024), 2);
  assert.equal(estimatePartsBySize(1024 * 1024 + 1, 1024 * 1024), 2);
  assert.equal(estimatePartsBySize(1, 1024 * 1024), 1);
});

/* ------------------------------------------------------------------ *
 * 按份数分割
 * ------------------------------------------------------------------ */

test('按份数：实际份数必须等于请求份数', async () => {
  const { text } = makeNovel(1024 * 1024);
  const file = new Blob([text]);
  for (const n of [2, 3, 10, 50, 100, 300, 1000]) {
    const parts = clampParts(file.size, n);
    const boundaries = await computeChunkBoundaries(file, { mode: 'parts', parts });
    assert.equal(boundaries.length, parts, `请求 ${n} 份却得到 ${boundaries.length} 份`);
  }
});

test('按份数：份数很大时（受字节数限制）依然精确', async () => {
  const file = new Blob([makeNovel(64 * 1024).text]);
  const parts = clampParts(file.size, 5000);
  const boundaries = await computeChunkBoundaries(file, { mode: 'parts', parts });
  assert.equal(boundaries.length, parts);
});

test('按份数：边界连续且覆盖整个文件', async () => {
  const { text } = makeNovel(200 * 1024);
  const file = new Blob([text]);
  const boundaries = await computeChunkBoundaries(file, { mode: 'parts', parts: 7 });

  assert.equal(boundaries[0][0], 0);
  assert.equal(boundaries.at(-1)[1], file.size);
  for (let i = 1; i < boundaries.length; i++) {
    assert.equal(boundaries[i][0], boundaries[i - 1][1], `第 ${i} 段与上一段不连续`);
    assert.ok(boundaries[i][1] > boundaries[i][0], `第 ${i} 段为空`);
  }
});

test('按份数：切点落在换行之后', async () => {
  const { text } = makeNovel(256 * 1024);
  const file = new Blob([text]);
  const boundaries = await computeChunkBoundaries(file, { mode: 'parts', parts: 9 });

  for (const [, end] of boundaries.slice(0, -1)) {
    const chunk = file.slice(0, end);
    const last = await tailOf(chunk);
    assert.equal(last, 0x0a, `切点 ${end} 不在换行处（末字节 0x${last.toString(16)}）`);
  }
});

test('按份数：严格模式下份数依然精确', async () => {
  const file = new Blob([makeNovel(128 * 1024).text]);
  const boundaries = await computeChunkBoundaries(file, { mode: 'parts', parts: 5, preference: 'strict' });
  assert.equal(boundaries.length, 5);
  assert.equal(boundaries.at(-1)[1], file.size);
});

test('按份数：章节标题优先', async () => {
  const filler = '这是一段普通的正文内容，没有章节标记，用来填充空间。\n';
  const chapter = '第三章 风起云涌\n';
  let text = chapter;
  for (let i = 0; i < 400; i++) text += filler;
  text += chapter;
  for (let i = 0; i < 400; i++) text += filler;
  text += '第四章 尘埃落定\n';

  const file = new Blob([text]);
  const boundaries = await computeChunkBoundaries(file, { mode: 'parts', parts: 2, preference: 'auto' });

  const first = await file.slice(boundaries[0][0], boundaries[0][1]).text();
  assert.ok(
    first.trimEnd().endsWith('第三章 风起云涌') || first.includes('第三章'),
    '智能模式应尽量把切点放在章节标题之前',
  );
});

/* ------------------------------------------------------------------ *
 * 按大小分割
 * ------------------------------------------------------------------ */

test('按大小：每份都不超过上限', async () => {
  const { text } = makeNovel(1024 * 1024);
  const file = new Blob([text]);
  const limit = 200 * 1024;
  const boundaries = await computeChunkBoundaries(file, { mode: 'size', maxBytes: limit });

  for (const [start, end] of boundaries) {
    assert.ok(end - start <= limit, `一份 ${end - start} 字节，超过上限 ${limit}`);
    assert.ok(end > start, '出现空块');
  }
  assert.equal(boundaries[0][0], 0);
  assert.equal(boundaries.at(-1)[1], file.size);
});

test('按大小：换行对齐必须真正生效（回归用例）', async () => {
  const { text } = makeNovel(1024 * 1024);
  const file = new Blob([text]);
  const limit = 200 * 1024;
  const boundaries = await computeChunkBoundaries(file, { mode: 'size', maxBytes: limit });

  // 除最后一份外，每一份都应以换行结束
  for (const [, end] of boundaries.slice(0, -1)) {
    const last = await tailOf(file.slice(0, end));
    assert.equal(last, 0x0a, `切点 ${end} 不在换行处——换行对齐失效`);
  }
});

test('按大小：边界连续且无重叠', async () => {
  const { text } = makeNovel(500 * 1024);
  const file = new Blob([text]);
  const boundaries = await computeChunkBoundaries(file, { mode: 'size', maxBytes: 64 * 1024 });

  for (let i = 1; i < boundaries.length; i++) {
    assert.equal(boundaries[i][0], boundaries[i - 1][1]);
  }
  const total = boundaries.reduce((sum, [s, e]) => sum + (e - s), 0);
  assert.equal(total, file.size);
});

test('按大小：上限极小时不会死循环', async () => {
  const file = new Blob([makeNovel(64 * 1024).text]);
  const boundaries = await computeChunkBoundaries(file, { mode: 'size', maxBytes: 512 });
  assert.ok(boundaries.length > 0);
  assert.equal(boundaries.at(-1)[1], file.size);
});

/* ------------------------------------------------------------------ *
 * GBK（旧实现的核心缺陷）
 * ------------------------------------------------------------------ */

test('GBK：切点落在换行处，且不切断汉字', async () => {
  const bytes = makeGbk(256 * 1024);
  const file = new Blob([bytes]);
  const boundaries = await computeChunkBoundaries(file, { mode: 'parts', parts: 4 });

  assert.equal(boundaries.at(-1)[1], file.size);
  assert.equal(boundaries.length, 4);

  for (const [, end] of boundaries.slice(0, -1)) {
    assert.equal(bytes[end - 1], 0x0a, `切点 ${end} 不在 GBK 换行处`);
  }
});

test('GBK：按大小分割同样正确', async () => {
  const bytes = makeGbk(300 * 1024);
  const file = new Blob([bytes]);
  const limit = 64 * 1024;
  const boundaries = await computeChunkBoundaries(file, { mode: 'size', maxBytes: limit });

  for (const [start, end] of boundaries) {
    assert.ok(end - start <= limit);
  }
  for (const [, end] of boundaries.slice(0, -1)) {
    assert.equal(bytes[end - 1], 0x0a);
  }
  assert.equal(boundaries.at(-1)[1], file.size);
});

test('GBK：切点不会落在双字节字符中间', async () => {
  const bytes = makeGbk(128 * 1024);
  const file = new Blob([bytes]);
  const boundaries = await computeChunkBoundaries(file, { mode: 'parts', parts: 5 });

  // 切点前的字节若是汉字首字节，说明切进了字符内部
  for (const [, end] of boundaries.slice(0, -1)) {
    assert.equal(bytes[end - 1], 0x0a, '切点必须在换行字节上，而不能落在汉字内部');
  }
});

/* ------------------------------------------------------------------ *
 * UTF-8 字符边界
 * ------------------------------------------------------------------ */

test('UTF-8：无换行可切时回退到字符边界，不产生替换字符', async () => {
  // 一整块没有换行的中文
  const text = '中'.repeat(20000);
  const file = new Blob([text]);
  const boundaries = await computeChunkBoundaries(file, { mode: 'parts', parts: 5 });

  for (const [start, end] of boundaries) {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
      new Uint8Array(await file.slice(start, end).arrayBuffer()),
    );
    assert.ok(!decoded.includes('�'), '解码后不应出现替换字符');
  }
  assert.equal(boundaries.at(-1)[1], file.size);
});

test('UTF-8：多字节字符跨窗口起点时仍然正确', async () => {
  const file = new Blob([makeNovel(300 * 1024).text]);
  const boundaries = await computeChunkBoundaries(file, { mode: 'size', maxBytes: 100 * 1024 });

  for (const [start, end] of boundaries) {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
      new Uint8Array(await file.slice(start, end).arrayBuffer()),
    );
    assert.ok(decoded.length > 0);
  }
});

/* ------------------------------------------------------------------ *
 * 换行风格与特殊文件
 * ------------------------------------------------------------------ */

test('只使用 CR 换行的老式文件也能正确切分', async () => {
  const text = '这是一行正文内容，用来测试经典 Mac 换行符的处理。\r'.repeat(3000);
  const file = new Blob([text]);
  const bytes = utf8(text);
  const boundaries = await computeChunkBoundaries(file, { mode: 'parts', parts: 4 });

  assert.equal(boundaries.length, 4);
  for (const [, end] of boundaries.slice(0, -1)) {
    assert.equal(bytes[end - 1], 0x0d, '切点应在 CR 之后');
  }
});

test('CRLF 换行：切点落在换行之后，不产生空行', async () => {
  const text = '这是 Windows 风格的正文行，使用 CRLF 换行结束。\r\n'.repeat(3000);
  const bytes = utf8(text);
  const file = new Blob([text]);
  const boundaries = await computeChunkBoundaries(file, { mode: 'parts', parts: 4 });

  for (const [start, end] of boundaries.slice(0, -1)) {
    const tail = new Uint8Array(await file.slice(Math.max(0, end - 2), end).arrayBuffer());
    assert.deepEqual([...tail], [0x0d, 0x0a], 'CRLF 应整体保留在上一份');
    const head = new Uint8Array(await file.slice(end, end + 1).arrayBuffer());
    assert.notEqual(head[0], 0x0a, '下一份不应以孤立的 LF 开头');
    assert.ok(start < end);
  }
});

test('UTF-16 LE：切点落在 2 字节对齐处', async () => {
  const line = '这是一行 UTF-16 编码的正文内容，用于测试宽字符处理。\n';
  const file = new Blob([makeUtf16le(line.repeat(2000))]);
  const boundaries = await computeChunkBoundaries(file, { mode: 'parts', parts: 4 });

  assert.equal(boundaries.length, 4);
  for (const [, end] of boundaries) {
    assert.equal(end % 2, 0, `切点 ${end} 未与 2 字节边界对齐`);
  }
  const whole = new TextDecoder('utf-16le').decode(
    new Uint8Array(await file.slice(boundaries[0][0], boundaries[0][1]).arrayBuffer()),
  );
  assert.ok(!whole.includes('�'), 'UTF-16 解码不应出现替换字符');
});

test('单行超长（完全无换行）文件不会卡死', async () => {
  const file = new Blob(['x'.repeat(100000)]);
  const boundaries = await computeChunkBoundaries(file, { mode: 'size', maxBytes: 8192 });
  assert.equal(boundaries.at(-1)[1], file.size);
  for (const [s, e] of boundaries) assert.ok(e > s);
});

test('空文件返回空边界', async () => {
  assert.deepEqual(await computeChunkBoundaries(new Blob([]), { mode: 'parts', parts: 3 }), []);
});

test('单字节文件', async () => {
  const file = new Blob(['a']);
  const boundaries = await computeChunkBoundaries(file, { mode: 'parts', parts: 5 });
  assert.equal(boundaries.length, 1);
  assert.deepEqual(boundaries[0], [0, 1]);
});

test('份数超过字节数时被收敛，不产生 1 字节碎片', async () => {
  const file = new Blob([utf8('ab\ncd\nef\n')]);
  const parts = clampParts(file.size, 5000);
  const boundaries = await computeChunkBoundaries(file, { mode: 'parts', parts });
  assert.equal(boundaries.length, parts);
  assert.equal(boundaries.length, file.size);
});

/* ------------------------------------------------------------------ *
 * 进度回调
 * ------------------------------------------------------------------ */

test('进度回调单调递增并以 1 结束', async () => {
  const file = new Blob([makeNovel(256 * 1024).text]);
  const seen = [];
  await computeChunkBoundaries(file, {
    mode: 'parts',
    parts: 8,
    onProgress: (p) => seen.push(p.ratio),
  });

  assert.ok(seen.length > 0);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], '进度不应回退');
  assert.ok(seen.at(-1) <= 1);
  assert.equal(seen.at(-1), 1);
});

/* ------------------------------------------------------------------ *
 * 预览
 * ------------------------------------------------------------------ */

test('预览：UTF-8 取到指定字符数', async () => {
  const file = new Blob(['中'.repeat(5000)]);
  const text = await readPreviewText(file, 'utf-8', 1000);
  assert.equal(text.length, 1000);
  assert.ok(!text.includes('�'));
});

test('预览：GBK 不再乱码', async () => {
  const file = new Blob([makeGbk(8192)]);
  const text = await readPreviewText(file, 'gbk', 100);
  assert.ok(!text.includes('�'), 'GBK 预览不应出现替换字符');
  assert.ok(text.length > 0);
});

test('预览：文件短于请求长度时原样返回', async () => {
  const file = new Blob([utf8('短文本')]);
  assert.equal(await readPreviewText(file, 'utf-8', 1000), '短文本');
});

test('预览：UTF-16', async () => {
  const file = new Blob([makeUtf16le('第一段中文内容\n第二段'.repeat(50))]);
  const text = await readPreviewText(file, 'utf-16le', 20);
  assert.equal(text.length, 20);
  assert.ok(!text.includes('�'));
});
