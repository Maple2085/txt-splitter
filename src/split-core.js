/**
 * split-core.js —— 文本分块核心算法
 *
 * 设计原则
 * ─────────
 * 1. **全程在字节层面工作**，不解码、不回编码。换行符 0x0A / 0x0D 在 UTF-8、GBK、
 *    Big5、ASCII、Latin-1 里都是单字节，字节扫描对所有单字节编码都正确，也不会出现
 *    "解码再编码回算"导致的偏移错乱（旧实现据此在 GBK 文件上切进了汉字中间）。
 * 2. **切点只向目标位置收敛**：按大小分割时绝不越过硬上限，保证每份都不超限。
 * 3. **纯函数 + 无 DOM 依赖**，可直接在 Node 中单元测试。
 *
 * 坐标约定：所有位置都是相对文件起点的字节偏移，区间记作 [start, end)。
 */

/** 与界面提示保持一致的最大份数 */
export const MAX_PARTS = 5000;

/** 向上游搜索切点的最大字节数 */
export const SEARCH_BACK = 4096;

/** 向下游搜索切点的最大字节数（仅在按份数模式下会让出一部分空间） */
export const SEARCH_FORWARD = 4096;

const LF = 0x0a;
const CR = 0x0d;

/**
 * 支持的文本编码。
 *   unit      —— 最小寻址单元（UTF-16 为 2 字节，切点必须落在偶数偏移）
 *   charAlign —— 无换行可切时是否回退到字符边界（只有 UTF-8 / ASCII 需要）
 *   wide      —— UTF-16 的字节序
 */
export const ENCODINGS = {
  'utf-8': { unit: 1, charAlign: true, label: 'UTF-8' },
  ascii: { unit: 1, charAlign: true, label: 'ASCII' },
  gbk: { unit: 1, charAlign: false, label: 'GBK / 国标简体' },
  big5: { unit: 1, charAlign: false, label: 'Big5 / 繁体中文' },
  'utf-16le': { unit: 2, charAlign: false, wide: 'le', label: 'UTF-16 LE' },
  'utf-16be': { unit: 2, charAlign: false, wide: 'be', label: 'UTF-16 BE' },
};

/** 切分位置偏好 */
export const BREAK_PREFERENCE = {
  /** 智能：换行 → 章节标题优先 → 字符边界 */
  auto: 'auto',
  /** 仅按换行 */
  line: 'line',
  /** 严格按字节，不做任何调整（最快，可能切断多字节字符） */
  strict: 'strict',
};

/** 章节标题行：第 X 章 / 第 X 节 / 第 X 回 / 第 X 卷 / 第 X 篇 / 第 X 部 */
const SECTION_RE =
  /^\s*第\s*[0-9０-９〇零一二三四五六七八九十百千万两]{1,10}\s*[章节節回卷篇部集]\s*(?![0-9０-９])/;

/** 其他常见的分卷标记 */
const SECTION_ALT_RE = /^\s*(序章|序言|楔子|引子|前言|后记|尾声|番外|终章|大结局)\s*$/;

const SECTION_LINE_PROBE = 48; // 每行最多读这么多字节来判断是否章节标题

/* ------------------------------------------------------------------ *
 * 通用工具
 * ------------------------------------------------------------------ */

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

/** 让出主线程：优先用 scheduler.yield（不受 setTimeout 4ms 钳制），否则退回 setTimeout */
function yieldToMain() {
  const scheduler = globalThis.scheduler;
  if (scheduler && typeof scheduler.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function alignDown(value, unit) {
  if (unit === 1) return Math.max(0, value);
  const rem = ((value % unit) + unit) % unit;
  return Math.max(0, value - rem);
}

function alignUp(value, unit) {
  if (unit === 1) return Math.max(0, value);
  return alignDown(value + unit - 1, unit);
}

async function readBytes(file, start, end) {
  if (end <= start) return new Uint8Array(0);
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

/* ------------------------------------------------------------------ *
 * 编码探测
 * ------------------------------------------------------------------ */

function decodesAsUtf8(bytes) {
  // 采样窗口末尾可能截断多字节字符，最多退掉 3 个字节再试
  for (let trim = 0; trim < 4 && bytes.length - trim > 0; trim++) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytes.length - trim));
      return true;
    } catch {
      /* 换一个 trim 继续试 */
    }
  }
  return false;
}

function isPureAscii(bytes) {
  for (let i = 0; i < bytes.length; i++) if (bytes[i] > 0x7f) return false;
  return true;
}

/**
 * 探测文本编码。只读文件开头的采样窗口，不读全文。
 * @returns {Promise<{name:string, unit:number, charAlign:boolean, wide?:string, label:string, bom:number}>}
 */
export async function detectTextEncoding(file, sampleSize = 65536) {
  const head = await readBytes(file, 0, Math.min(sampleSize, file.size));

  if (head.length >= 2) {
    if (head[0] === 0xff && head[1] === 0xfe) return { name: 'utf-16le', bom: 2, ...ENCODINGS['utf-16le'] };
    if (head[0] === 0xfe && head[1] === 0xff) return { name: 'utf-16be', bom: 2, ...ENCODINGS['utf-16be'] };
  }
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
    return { name: 'utf-8', bom: 3, ...ENCODINGS['utf-8'] };
  }
  if (isPureAscii(head)) return { name: 'ascii', bom: 0, ...ENCODINGS.ascii };
  if (decodesAsUtf8(head)) return { name: 'utf-8', bom: 0, ...ENCODINGS['utf-8'] };

  // 非 UTF-8 的多字节中文文本，按 GBK 处理（覆盖 GB2312 / GBK 及大部分国标扩展）
  return { name: 'gbk', bom: 0, ...ENCODINGS.gbk };
}

/** 把编码名映射成 TextDecoder 能接受的 label */
export function decoderLabel(encodingName) {
  if (encodingName === 'gbk' || encodingName === 'big5') return 'gbk';
  if (encodingName === 'utf-16le') return 'utf-16le';
  if (encodingName === 'utf-16be') return 'utf-16be';
  return 'utf-8';
}

/* ------------------------------------------------------------------ *
 * 换行与章节扫描（全部基于字节）
 * ------------------------------------------------------------------ */

/** 单字节编码：找离 pivot 最近的 breakCode，返回"断点之后第一个字节"的相对下标 */
function scanNarrow(bytes, pivot, breakCode) {
  let before = -1;
  let after = -1;

  for (let p = Math.min(pivot, bytes.length) - 1; p >= 0; p--) {
    if (bytes[p] === breakCode) {
      before = p + 1;
      break;
    }
  }
  const start = Math.min(Math.max(pivot, 0), Math.max(bytes.length - 1, 0));
  for (let p = start; p < bytes.length; p++) {
    if (bytes[p] === breakCode) {
      after = p + 1;
      break;
    }
  }

  if (before < 0) return after;
  if (after < 0) return before;
  return pivot - before <= after - pivot ? before : after;
}

/** UTF-16：按 2 字节步进找换行，pivot 与窗口起点都必须与文件起点同奇偶 */
function scanWide(bytes, pivot, breakCode, endian) {
  const isBreak = (p) =>
    endian === 'le'
      ? bytes[p] === breakCode && bytes[p + 1] === 0x00
      : bytes[p] === 0x00 && bytes[p + 1] === breakCode;

  let before = -1;
  let after = -1;

  for (let p = Math.min(pivot, bytes.length) - 2; p >= 0; p -= 2) {
    if (isBreak(p)) {
      before = p + 2;
      break;
    }
  }
  const start = Math.min(Math.max(pivot, 0), Math.max(bytes.length - 2, 0));
  for (let p = start; p + 1 < bytes.length; p += 2) {
    if (isBreak(p)) {
      after = p + 2;
      break;
    }
  }

  if (before < 0) return after;
  if (after < 0) return before;
  return pivot - before <= after - pivot ? before : after;
}

/** 找出窗口内所有换行符之后的位置（字节偏移，相对于窗口起点） */
function listLineStarts(bytes, enc) {
  const starts = [];
  if (enc.wide) {
    const [hi, lo] = enc.wide === 'le' ? [0x00, LF] : [LF, 0x00];
    for (let p = 0; p + 1 < bytes.length; p += 2) {
      if (bytes[p] === lo && bytes[p + 1] === hi) starts.push(p + 2);
    }
    return starts;
  }
  for (let p = 0; p < bytes.length; p++) {
    if (bytes[p] === LF || bytes[p] === CR) {
      // CRLF 视为一个断点
      if (p + 1 < bytes.length && ((bytes[p] === CR && bytes[p + 1] === LF) || (bytes[p] === LF && bytes[p + 1] === CR))) {
        starts.push(p + 2);
        p++;
      } else {
        starts.push(p + 1);
      }
    }
  }
  return starts;
}

/**
 * 在窗口内寻找章节标题行的起点。
 *
 * 关键点：候选位置全部来自**字节级**的换行扫描，因此对任何编码都是精确的；
 * 只在判断"这一行是不是标题"时才做一次 48 字节的小解码。
 * 这样既不需要把字符下标换算回字节偏移，也不会出现偏移错位。
 */
function findSectionStartInWindow(bytes, enc, decoder, windowStart, cursor, limit) {
  const starts = listLineStarts(bytes, enc);
  let best = -1;
  let bestDistance = Infinity;

  for (const rel of starts) {
    if (rel <= 0 || rel >= bytes.length) continue;
    const abs = windowStart + rel;
    if (abs <= cursor || abs > limit) continue;

    const probe = bytes.subarray(rel, Math.min(bytes.length, rel + SECTION_LINE_PROBE));
    let line;
    try {
      line = decoder.decode(probe);
    } catch {
      continue;
    }
    if (!SECTION_RE.test(line) && !SECTION_ALT_RE.test(line)) continue;

    // 取边界内最接近窗口中心（即理想切点）的那一个
    const distance = Math.abs(abs - (windowStart + Math.floor(bytes.length / 2)));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = abs;
    }
  }

  return best;
}

/**
 * 在 [cursor, limit] 内、target 附近选择切点。
 * @returns {Promise<number>} 绝对字节偏移；找不到返回 -1
 */
async function chooseBreak(file, cursor, target, enc, back, forward, limit, preference) {
  const unit = enc.unit;
  const lo = Math.max(cursor, alignDown(target - back, unit));
  const hi = Math.min(limit, alignUp(target + forward, unit));
  if (hi <= lo) return -1;

  const bytes = await readBytes(file, lo, hi);
  if (bytes.length < unit) return -1;

  const pivot = alignDown(Math.min(Math.max(target - lo, 0), Math.max(bytes.length - unit, 0)), unit);

  // 智能模式：先看窗口里有没有章节标题
  if (preference === BREAK_PREFERENCE.auto) {
    const decoder = new TextDecoder(decoderLabel(enc.name));
    const section = findSectionStartInWindow(bytes, enc, decoder, lo, cursor, limit);
    if (section > 0) return section;
  }

  // 再找换行；窗口内没有 LF 时才退回 CR（经典 Mac 换行）
  for (const code of [LF, CR]) {
    const rel = enc.wide ? scanWide(bytes, pivot, code, enc.wide) : scanNarrow(bytes, pivot, code);
    if (rel >= 0) {
      const abs = lo + rel;
      if (abs > cursor && abs <= limit) return abs;
    }
  }
  return -1;
}

/**
 * UTF-8 字符边界对齐：若 abs 落在多字节字符中间，向前回退到字符起点。
 * 只在找不到换行时使用，且只对 UTF-8 / ASCII 调用。
 */
async function alignUtf8Down(file, abs, minAbs) {
  if (abs >= file.size) return abs;
  const from = Math.max(minAbs, abs - 3);
  const bytes = await readBytes(file, from, Math.min(file.size, abs + 1));
  if (!bytes.length) return abs;

  let i = bytes.length - 1; // 指向 abs 处的那个字节
  while (i > 0 && (bytes[i] & 0xc0) === 0x80) i--; // 0x80-0xBF 是续接字节
  return from + i;
}

/* ------------------------------------------------------------------ *
 * 对外 API
 * ------------------------------------------------------------------ */

/** 把请求份数限制在 [1, min(MAX_PARTS, 文件字节数)] */
export function clampParts(fileSize, parts) {
  const requested = Math.floor(Number(parts)) || 1;
  const byBytes = Math.max(1, Math.floor(fileSize));
  return Math.max(1, Math.min(requested, MAX_PARTS, byBytes));
}

/** 估算按大小分割会得到多少份 */
export function estimatePartsBySize(fileSize, maxBytes) {
  const limit = Math.max(1, Math.floor(maxBytes));
  return Math.max(1, Math.ceil(fileSize / limit));
}

/**
 * 计算分块边界。
 *
 * @param {Blob|File} file
 * @param {object} options
 * @param {'parts'|'size'} options.mode
 * @param {number} [options.parts]            按份数模式：期望份数
 * @param {number} [options.maxBytes]         按大小模式：每份上限（字节）
 * @param {object} [options.encoding]         detectTextEncoding() 的结果；省略则自动探测
 * @param {string} [options.preference]       切分位置偏好，见 BREAK_PREFERENCE
 * @param {(p:{ratio:number,index:number,total:number})=>void} [options.onProgress]
 * @param {number} [options.yieldEveryMs=16]  主线程让出间隔
 * @returns {Promise<Array<[number, number]>>} [start, end) 边界数组
 */
export async function computeChunkBoundaries(file, options = {}) {
  const {
    mode = 'parts',
    parts = 1,
    maxBytes = Number.POSITIVE_INFINITY,
    encoding,
    preference = BREAK_PREFERENCE.auto,
    onProgress,
    yieldEveryMs = 16,
  } = options;

  const size = file.size;
  if (size <= 0) return [];

  const enc = encoding && ENCODINGS[encoding.name] ? { ...encoding, ...ENCODINGS[encoding.name] } : await detectTextEncoding(file);
  const strict = preference === BREAK_PREFERENCE.strict;

  const boundaries = [];
  let cursor = 0;
  let lastYield = now();

  const tick = async (index, total) => {
    if (onProgress) onProgress({ ratio: total > 0 ? Math.min(1, index / total) : 1, index, total });
    if (now() - lastYield >= yieldEveryMs) {
      await yieldToMain();
      lastYield = now();
    }
  };

  if (mode === 'size') {
    const limit = Math.max(1, Math.floor(maxBytes));
    const total = Math.max(1, Math.ceil(size / limit));
    let index = 0;

    while (cursor < size) {
      const hardEnd = Math.min(size, cursor + limit);
      let end = hardEnd;

      if (!strict && hardEnd < size) {
        // 只向上游回退，绝不越过 hardEnd —— 保证每份都不超过 maxBytes
        const hit = await chooseBreak(file, cursor, hardEnd, enc, SEARCH_BACK, 0, hardEnd, preference);
        if (hit > 0) {
          end = hit;
        } else if (enc.charAlign) {
          end = await alignUtf8Down(file, hardEnd, cursor + 1);
        }
        if (end <= cursor) end = hardEnd; // 兜底：至少推进到硬上限
      }

      boundaries.push([cursor, end]);
      cursor = end;
      index += 1;
      await tick(index, total);
    }
    return boundaries;
  }

  // 按份数分割：把文件理想均分成 n 段，每个分割点吸附到最近的换行 / 章节。
  //
  // 关键约束：第 i 段结束时必须给后面的 (n - i) 段各留下至少 1 个字节，
  // 即 end <= size - (n - i)。吸附到换行可能向后越走越远，没有这个上限时
  // 就会出现"请求 5000 份只得到几百份"（旧实现的问题）。
  const n = clampParts(size, parts);
  for (let i = 1; i <= n; i++) {
    const remaining = n - i;
    let end;

    if (i === n) {
      end = size; // 最后一段吃掉剩余内容，保证恰好 n 份
    } else {
      const maxEnd = size - remaining; // 留够后面每段至少 1 字节
      const ideal = Math.round((size * i) / n);
      const target = Math.min(Math.max(ideal, cursor + 1), maxEnd);
      let hit = -1;

      if (!strict) {
        hit = await chooseBreak(file, cursor, target, enc, SEARCH_BACK, SEARCH_FORWARD, maxEnd, preference);
      }

      end = hit > 0 ? hit : target;
      if (!strict && hit <= 0 && enc.charAlign) end = await alignUtf8Down(file, end, cursor + 1);

      // 吸附结果可能落到窗口外或越过上限，统一收敛到 [cursor + 1, maxEnd]。
      // maxEnd >= cursor + 1 由上一步结束时留下的余量保证，见上方注释。
      if (end > maxEnd) end = maxEnd;
      if (end <= cursor) end = cursor + 1;
    }

    boundaries.push([cursor, end]);
    cursor = end;
    await tick(i, n);
  }

  return boundaries;
}

/**
 * 读取一段内容用于预览，按探测到的编码解码。
 * @returns {Promise<string>} 最多 maxChars 个字符
 */
export async function readPreviewText(blob, encodingName = 'utf-8', maxChars = 1000) {
  const probe = Math.min(blob.size, maxChars * 4 + 16);
  const bytes = await readBytes(blob, 0, probe);

  let text;
  try {
    text = new TextDecoder(decoderLabel(encodingName)).decode(bytes);
  } catch {
    text = new TextDecoder('utf-8').decode(bytes);
  }
  // 结尾可能截断在多字节字符中间，去掉末尾的替换字符
  return text.replace(/�+$/, '').slice(0, maxChars);
}
