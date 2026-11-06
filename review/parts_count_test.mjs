// 验证：按份数分割时，实际生成份数是否等于用户请求的份数
import { split } from './split_core.mjs';
const line = '这是一行大约四十个汉字长度的中文小说正文，用于模拟真实的电子书换行密度。\n';
const text = line.repeat(Math.ceil(1024 * 1024 / new TextEncoder().encode(line).length));
const file = new Blob([text]);
console.log('样本', file.size, 'bytes, 每行', new TextEncoder().encode(line).length, 'bytes\n');
console.log('请求份数 | 实际份数 | 目标每份 | 实际平均每份');
for (const parts of [3, 10, 50, 100, 300, 500, 1000, 2000, 5000]) {
  const r = await split(file, 'parts', parts, Infinity);
  const avg = Math.round(file.size / r.splitFiles.length);
  console.log(String(parts).padStart(8), '|', String(r.splitFiles.length).padStart(8), '|', String(Math.ceil(file.size/parts)).padStart(8), '|', String(avg).padStart(10), r.splitFiles.length !== parts ? '  <-- 偏差' : '');
}
