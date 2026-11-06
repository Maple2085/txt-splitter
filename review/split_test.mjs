// 逐字复刻 index.html 中 processSplit 的核心循环，验证分割边界行为
async function split(file, currentMode, partsCount, maxChunkBytes) {
  const splitFiles = [];
  const targetBytes = currentMode === 'size' ? maxChunkBytes : Math.ceil(file.size / partsCount);
  let currentOffset = 0;
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  const encoder = new TextEncoder();
  const alignToCharBoundary = (bytes, windowStart, end, minimumOffset) => {
    const relativeEnd = Math.max(0, Math.min(bytes.length, end - windowStart));
    let idx = relativeEnd;
    while (idx > 0 && idx < bytes.length && (bytes[idx] & 0xC0) === 0x80) idx--;
    const aligned = windowStart + idx;
    if (aligned > minimumOffset) return aligned;
    if (idx === 0 && relativeEnd < bytes.length && (bytes[relativeEnd] & 0xC0) === 0x80) {
      let next = relativeEnd + 1;
      while (next < bytes.length && (bytes[next] & 0xC0) === 0x80) next++;
      return windowStart + next;
    }
    return end;
  };
  const maxIterations = currentMode === 'size' ? 5000 : partsCount;
  let alignedByNewline = 0, fallbackChar = 0;
  for (let i = 0; currentOffset < file.size && i < maxIterations; i++) {
    const maxEnd = Math.min(file.size, currentOffset + maxChunkBytes);
    let chunkEnd = Math.min(currentOffset + targetBytes, maxEnd);
    if ((currentMode === 'size' || i < partsCount - 1) && chunkEnd < file.size) {
      let windowStart = Math.max(currentOffset, chunkEnd - 2560);
      const windowEnd = Math.min(file.size, chunkEnd + 2560);
      let windowBytes = new Uint8Array(await file.slice(windowStart, windowEnd).arrayBuffer());
      while (windowBytes.length > 0 && (windowBytes[0] & 0xC0) === 0x80) { windowStart++; windowBytes = windowBytes.slice(1); }
      const windowText = decoder.decode(windowBytes);
      const lastNewlineIdx = windowText.lastIndexOf('\n');
      let aligned = false;
      if (lastNewlineIdx !== -1) {
        const bytesBeforeNewline = encoder.encode(windowText.substring(0, lastNewlineIdx + 1)).length;
        const safeChunkEnd = windowStart + bytesBeforeNewline;
        if (safeChunkEnd > currentOffset && safeChunkEnd <= file.size && safeChunkEnd <= currentOffset + maxChunkBytes) {
          chunkEnd = safeChunkEnd; aligned = true;
        }
      }
      if (!aligned) { chunkEnd = alignToCharBoundary(windowBytes, windowStart, chunkEnd, currentOffset); fallbackChar++; } else alignedByNewline++;
    } else chunkEnd = maxEnd;
    const chunkBlob = file.slice(currentOffset, chunkEnd);
    currentOffset = chunkEnd;
    if (chunkBlob.size === 0) continue;
    splitFiles.push(chunkBlob);
  }
  return { splitFiles, alignedByNewline, fallbackChar, leftover: file.size - currentOffset };
}

// 构造一个 1MB 的中文小说样本：每行约 60 个汉字 + \n
const line = '第一章 这是一行用于测试的中文文本，包含常见的标点符号，长度大约六十个汉字左右，用来模拟小说正文。\n';
const text = line.repeat(Math.ceil(1024 * 1024 / new TextEncoder().encode(line).length));
const file = new Blob([text], { type: 'text/plain' });
console.log('样本大小:', file.size, 'bytes, 每行', new TextEncoder().encode(line).length, 'bytes');

for (const [mode, parts, maxBytes] of [['parts', 5, Infinity], ['size', 0, Math.floor(0.2 * 1024 * 1024)]]) {
  const r = await split(file, mode, parts, maxBytes);
  console.log(`\n== 模式=${mode} parts=${parts} maxChunk=${maxBytes} ==`);
  console.log('生成份数:', r.splitFiles.length, ' 换行对齐次数:', r.alignedByNewline, ' 回退字符边界次数:', r.fallbackChar, ' 剩余字节:', r.leftover);
  for (let i = 0; i < r.splitFiles.length; i++) {
    const b = r.splitFiles[i];
    const tail = await b.slice(Math.max(0, b.size - 1)).text();
    const head = await b.slice(0, 30).text();
    console.log(`  P${i+1}: ${b.size} bytes, 结尾是换行? ${tail === '\n' ? 'YES' : 'NO -> 切在行中间'}  开头: ${JSON.stringify(head)}`);
  }
}
