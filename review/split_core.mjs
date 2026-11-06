// 逐字复刻 index.html 中 processSplit 的核心循环，验证分割边界行为
export async function split(file, currentMode, partsCount, maxChunkBytes) {
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

