// GBK 文件：行内容 "中文" 重复（GBK: 中=D6D0 文=CEC4），行尾 0x0A。用 index.html 现行算法计算切点。
const lineBytes = [];
for (let i = 0; i < 30; i++) lineBytes.push(0xD6, 0xD0, 0xCE, 0xC4);
lineBytes.push(0x0A);
const line = new Uint8Array(lineBytes);              // 121 bytes/行
const total = 2000;                                   // 2000 行 ≈ 242KB
const buf = new Uint8Array(line.length * total);
for (let i = 0; i < total; i++) buf.set(line, i * line.length);
const file = new Blob([buf]);
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
const encoder = new TextEncoder();

// 复刻：按份数分 3 份，第 1 个切点
const partsCount = 3, maxChunkBytes = Infinity;
const targetBytes = Math.ceil(file.size / partsCount);
let currentOffset = 0, chunkEnd = currentOffset + targetBytes;
let windowStart = Math.max(currentOffset, chunkEnd - 2560);
const windowEnd = Math.min(file.size, chunkEnd + 2560);
let windowBytes = new Uint8Array(await file.slice(windowStart, windowEnd).arrayBuffer());
while (windowBytes.length > 0 && (windowBytes[0] & 0xC0) === 0x80) { windowStart++; windowBytes = windowBytes.slice(1); }
const windowText = decoder.decode(windowBytes);
const lastNewlineIdx = windowText.lastIndexOf('\n');
const bytesBeforeNewline = encoder.encode(windowText.substring(0, lastNewlineIdx + 1)).length;
const safeChunkEnd = windowStart + bytesBeforeNewline;
console.log('文件大小:', file.size, ' 目标切点:', chunkEnd, ' 窗口:', windowStart, '-', windowEnd);
console.log('解码后窗口文本含 U+FFFD 个数:', (windowText.match(/�/g) || []).length, '/ 窗口字节数', windowBytes.length);
console.log('算法算出的 safeChunkEnd:', safeChunkEnd, ' 是否超出窗口:', safeChunkEnd > windowEnd ? 'YES(偏差 ' + (safeChunkEnd - windowEnd) + ' 字节)' : 'no');
console.log('通过校验(<= file.size)?', safeChunkEnd <= file.size, ' -> 会被采用为切点');
const b = buf[safeChunkEnd - 1];
console.log('切点前一字节: 0x' + b.toString(16).toUpperCase(), b === 0x0A ? '(换行，正确)' : '(不是换行 → 切在行中间/GBK 字符中间)');
// 对照：直接在字节层面向前找 0x0A
let k = chunkEnd - windowStart; while (k > 0 && windowBytes[k - 1] !== 0x0A) k--;
console.log('字节级扫描 0x0A 得到切点:', windowStart + k, ' 前一字节 0x' + buf[windowStart + k - 1].toString(16).toUpperCase());
