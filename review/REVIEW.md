# txt-splitter 代码审查报告（完整版）

| 项目 | 内容 |
|---|---|
| 审查对象 | `E:\CodingProjects\txt-splitter`，复制自 `E:\Github\txt-splitter`，commit `0ed9237`（main），功能版本 v2.4.1 |
| 审查日期 | 2026-10-01 |
| 审查范围 | `index.html` 全部（CSS 27.9 KB / HTML 6.5 KB / 内联第三方库 100.5 KB / 应用 JS 23.3 KB）、`README.md`、`CHANGELOG.md`、`备份/`、仓库结构 |
| 验证方式 | 静态阅读 + Node 24 复现脚本（本目录 `*.mjs`，`node review/<名字>.mjs` 直接运行）+ 与 cdnjs 官方文件逐字节比对 |

标注「已复现」的问题都有脚本或命令输出作证据；其余是代码阅读结论。

---

## 0. 总体评价

这是一个目标清晰、打磨过多轮的单文件工具：纯本地处理、零依赖分发、Blob 切片不读全文、UTF-8 边界处理、ARIA 语义、动画偏好尊重，这些在同类小工具里都属于少见的用心。内联的 JSZip 3.10.1 与 FileSaver 2.0.5 已与 cdnjs 官方文件逐字节比对（仅换行符差异），没有被篡改。

问题集中在三块：

1. **分割算法**在"按大小"和"按份数"两种模式下都偏离了设计意图，而且对国内最常见的 GBK 编码失效。这是核心功能，优先级最高。
2. **运行时状态**：Toast 死循环会冻结页面；处理过程中切换模式或换文件会污染结果；错误路径的 UI 收尾不完整。
3. **工程化**：160 KB 单文件里 100 KB 是一行的压缩库，没有测试，README 被 changelog 覆盖，仓库里混进了非代码文件。

---

## 1. 分割算法

### 1.1 按大小分割时换行对齐完全失效 【已复现：`split_test.mjs`】

位置：`index.html:1521`

```js
safeChunkEnd <= currentOffset + maxChunkBytes   // 按大小模式下几乎永远为 false
```

按大小模式 `targetBytes === maxChunkBytes`，`chunkEnd` 恰好等于上限。搜索窗口是 `chunkEnd ± 2560`，`lastIndexOf('\n')` 取窗口里**最后一个**换行，几乎总在 `chunkEnd` 之后，于是超出上限被拒，退回字符边界对齐。

| 模式 | 换行对齐成功 | 回退字符边界 | 结尾切在行中间 |
|---|---|---|---|
| 按份数 5 份 | 4 | 0 | 0 / 5 |
| 按大小 0.2 MB | 0 | 5 | 5 / 6 |

小米手环场景（2 MB 限制）走的正是按大小模式，每一份的首尾都是半句话。

### 1.2 按份数分割时实际份数远少于请求 【已复现：`parts_count_test.mjs`】

同一个 ±2560 窗口在按份数模式下造成另一个问题：每次都选窗口里**最后**的换行，也就是目标点之后最多 2560 字节的位置。当每份目标大小接近或小于 2560 字节时，每份都会比目标大出约 2.5 KB：

| 请求份数 | 实际份数 | 目标每份(B) | 实际平均(B) |
|---|---|---|---|
| 10 | 10 | 104858 | 104858 |
| 50 | 45 | 20972 | 23302 |
| 100 | 81 | 10486 | 12945 |
| 500 | 230 | 2098 | 4559 |
| 1000 | 292 | 1049 | 3591 |
| 5000 | 385 | 210 | 2724 |

用户输入 5000 份，拿到 385 份。界面上限写着 5000，实际在 1 MB 文件上超过 40 份就开始偏离。

### 1.3 GBK / GB2312 文件切点算错，切在汉字中间 【已复现：`gbk_test.mjs`】

位置：`index.html:1472`（`TextDecoder('utf-8')`）、`index.html:1512`（解码后找换行，再 `encode` 回算字节数）

国内小说站的 txt 大量是 GBK。算法把 GBK 字节按 UTF-8 解码，5120 字节的窗口产生 5078 个 `U+FFFD`；`encoder.encode()` 回算时每个 `U+FFFD` 变成 3 字节，算出的切点比窗口尾部还多出 9856 字节，且满足 `<= selectedFile.size` 被采用：

```
目标切点 80667 → 算法给出 93083（前一字节 0xD0，GBK 双字节字的首字节，切在字中间）
字节级扫描 0x0A → 80586（前一字节 0x0A，正确）
```

另外 `while ((windowBytes[0] & 0xC0) === 0x80)` 这个"跳过 UTF-8 续接字节"的循环对 GBK 字节是随机行为。

### 1.4 只认 `\n`，不认 `\r`；不支持 UTF-16

旧 Mac 或某些阅读器导出的文件只用 `\r` 换行，整份文件会永远走字符边界回退。UTF-16 文件（Windows 记事本"Unicode"编码）的换行是 `0A 00`，按字节切会落在奇数偏移，输出文件打不开。可通过 BOM `FF FE` / `FE FF` 识别并把切点对齐到偶数。

### 1.5 统一修法：字节级向前扫描，不解码

1.1 到 1.3 的根因相同：**不该解码，也不该向后看**。`0x0A` 在 ASCII / UTF-8 / GBK / Big5 / Latin-1 里都是单字节换行，直接在字节上找就行：

```js
async function findChunkEnd(file, start, target, maxBytes, isUtf8) {
    const hardEnd = Math.min(file.size, start + maxBytes, start + target);
    if (hardEnd >= file.size) return file.size;
    const back = Math.max(start, hardEnd - 4096);
    const win = new Uint8Array(await file.slice(back, hardEnd).arrayBuffer());
    const nl = win.lastIndexOf(0x0A);                 // 也可同时找 0x0D
    if (nl !== -1 && back + nl + 1 > start) return back + nl + 1;
    return isUtf8 ? alignToCharBoundary(win, back, hardEnd, start) : hardEnd;
}
```

- `safeChunkEnd <= hardEnd` 恒成立，1.1 的条件判断、1.2 的向后偏移、1.3 的编码回算全部消失；
- `TextDecoder` / `TextEncoder` / "跳过续接字节"循环都可以删掉；
- 这个函数是纯函数，可以直接用 `node --test` 覆盖（见 §7.5）。

更进一步的产品级优化：电子书用户真正想要的切点是**章节标题**（`^第[一二三四五六七八九十百千0-9]+[章节回卷]`）或空行。可以在窗口里优先找章节标题行首，其次空行，最后普通换行。

### 1.6 让出主线程的方式低效

位置：`index.html:1551`

每轮 `await new Promise(r => setTimeout(r, 0))`。浏览器对嵌套 `setTimeout` 第 5 层起钳制到 ≥ 4 ms，5000 轮纯等待超过 20 s，而每轮的真实工作只是读几 KB。改成按时间片让出：

```js
let last = performance.now();
if (performance.now() - last > 16) {
    await (globalThis.scheduler?.yield?.() ?? new Promise(r => setTimeout(r, 0)));
    last = performance.now();
}
```

### 1.7 边界情况

- **份数大于文件字节数**：100 字节的文件选 5000 份，`targetBytes = 1`，靠字符边界推进，产生几十个 1~3 字节的文件。应 `partsCount = Math.min(partsCount, file.size)` 并提示。
- **空文件**：循环不执行，`splitFiles` 为空，没有任何提示，但结果区和 ZIP 按钮照常显示；估算栏显示「每份约 0.00 KB」。应在 `handleFile` 直接拒绝。
- **按大小模式估算超 5000 份不提示**：`updateEstimate` 会显示「预估 100000 份」，点开始后才报错。估算阶段就应标红。

---

## 2. 运行时状态与并发

### 2.1 分割循环中实时读取全局 `currentMode` 和 `selectedFile`

位置：`index.html:1494` 到 `1555`，循环体内有 11 处直接读 `currentMode` / `selectedFile`

处理期间上传区、模式按钮都没有禁用。用户在进度条走动时：

- 点「按大小分割」→ 循环中途 `currentMode` 变成 `'size'`，`maxChunkBytes` 还是 `Infinity`，`maxIterations` 已固定，进度百分比公式切换，产出混合两种模式的结果；
- 拖入另一个文件 → `selectedFile` 换成新文件，循环继续用旧偏移量切新文件，输出是两份文件的碎片，命名用的还是新文件名。

修法：函数开头 `const file = selectedFile, mode = currentMode;`，循环只用局部变量；处理期间给上传区和模式按钮加 `disabled` / `aria-disabled` 并忽略 drop。

### 2.2 Toast 超过 3 条时整页死循环 【已复现：`toast_test.mjs`】

位置：`index.html:1726`

```js
while (container.children.length >= MAX_TOASTS) {
    removeToast(container.firstElementChild);   // 只是 300ms 后再移除，length 同步不变
}
```

连续点 4 个文件的「复制」，或拖 4 次非 txt 文件，页面立即冻结到只能关标签页。这个 `while` 是 v2.3.0 "修复 Toast 内存泄漏"时引入的。

```js
const active = [...container.children].filter(t => !t.classList.contains('toast-exit'));
while (active.length >= MAX_TOASTS) removeToast(active.shift());
```

### 2.3 错误路径不收尾

- `processSplit` 在 `try` 之前就把 `result-area` 设为可见，`catch` 里只清空数组，`finally` 后仍执行 `listEl.style.display = 'block'`。分割失败后用户看到的是一个空列表和一个可点的「打包下载全部」按钮（点了提示「请先分割文件」）。
- `showPreview`（`index.html:1694`）没有 `try/catch`。`slice.text()` 在移动端抛错正是 issue #1 的场景，这里会变成 unhandled rejection：对话框不开、没有提示、`previewTrigger` 残留。
- `clearInputErrors` 只移除 `error-text` 类，不恢复 `textContent`。触发一次校验错误后，提示区会永久显示灰色的错误文案（「请输入大于 0 的有效分割份数」），原本的「请输入 1-5000 之间的整数」再也不出现。

### 2.4 其他输入处理

- `<input type=file>` 的 `value` 从不重置（`index.html:1260`），同一文件无法重新选择。
- 拖入多个文件静默只取 `files[0]`，应提示「仅支持单个文件」。
- `parseInt('3.7')` 静默取 3；建议 `Number.isInteger` 校验并提示。
- 完成后进度条立即隐藏，100% 状态从未可见；可停留 400 ms 或改显示「完成」。

---

## 3. HTML 语义与可访问性

### 3.1 `aria-describedby` 指向不存在的 id

`index.html:1139`：`<button id="split-btn" aria-describedby="estimate-text">`，但估算元素是 `id="estimate" class="estimate-text"`。引用的是类名而不是 id，读屏器拿不到描述。这个属性从 v2.2 起就是坏的。

### 3.2 结构语义

- `<div class="container" role="main">` → 直接用 `<main>`。
- `<h2>拖放或点击上传</h2>` 放在 `role="button"` 的 div 里：按钮内部出现标题，读屏器会在"按钮"和"标题"两种导航模式下重复读到它。改成 `<p class="upload-title">`，无障碍名称已经由 `aria-label` 提供。
- `<li tabindex="0" role="listitem">` 同时承担"点击下载"并内嵌两个 `<button>`：嵌套可交互控件，`aria-label` 里的「按 Enter 下载」和内部按钮会被重复播报；`role="listitem"` 在 `ul > li` 上冗余。建议文件名改成真正的 `<button class="file-link">`，`li` 只做容器，`li.onclick`、`keydown` 和 `e.target !== li` 的判断全部删除。
- `role="document"` 放在 `<pre>` 上没有必要；`aria-modal="true"` 在 `showModal()` 的 `<dialog>` 上是冗余的（无害）。
- 关闭按钮用了内联 `onclick="closePreview()"`（`index.html:1210`），全文其他地方都是 `addEventListener`；内联事件处理器也会挡住将来的 CSP（见 §5.2）。

### 3.3 Live region 的用法

- 每条 Toast 自己带 `role="status" aria-live="polite"`，并且是**带着内容被插入**的。多数读屏器只播报已存在的 live region 内部的变化，动态插入一个已有内容的 live region 经常不读。应把 `aria-live` 放在常驻的 `#toast-container` 上，Toast 只作为子节点追加。
- 错误类 Toast 也是 `status` / `polite`，错误应为 `role="alert"` / `assertive`。
- `#status`（`index.html:1155`）是一个永远为空的 `role="alert" aria-live="assertive"` 元素，JS 从不写入。

### 3.4 Tab 组缺少方向键

`role="tablist"` / `role="tab"` / 漫游 `tabindex` 都做了，但只能用鼠标切换。WAI-ARIA Tabs 模式要求 ←/→ 切换，大约十行代码。

### 3.5 CHANGELOG 声称的"点击遮罩关闭"并未实现

`CHANGELOG.md:52` 写「覆盖 ESC / 关闭按钮 / 点击遮罩等所有关闭路径」，但 `#preview-dialog` 上只有 `close` 事件监听，没有任何 `click` 处理；点击遮罩不会关闭对话框。要么补上（`dialog.onclick = e => e.target === dialog && dialog.close()`），要么修正文档。

### 3.6 颜色对比度（WCAG 2.1 AA 要求正文 4.5:1，大字 3:1）

| 元素 | 前景 | 背景 | 对比度 | 结论 |
|---|---|---|---|---|
| `.file-size-display` 文件大小 | #94a3b8 | #ffffff | 2.56:1 | 不达标 |
| `.input-hint` 输入提示 | #94a3b8 | #f8fafc | 2.45:1 | 不达标 |
| `.input-hint` 聚焦态 | #94a3b8 | #eef2ff | 2.29:1 | 不达标 |
| `.btn:disabled` 禁用按钮 | #ffffff | #cbd5e1 | 1.48:1 | 不达标（处理中的「处理中...」就是这个状态） |
| `.estimate-text` 估算 | #64748b | #f1f5f9 | 4.34:1 | 略低于 4.5 |
| `.file-size-tag` 大小标签 | #64748b | #f1f5f9 | 4.34:1 | 略低于 4.5 |
| `.preview-btn` 预览按钮 | #0284c7 | #f0f9ff | 3.84:1 | 0.8rem 小字，不达标 |
| `.zip-btn` ZIP 按钮 | #ffffff | #f72585 | 3.78:1 | 1.1rem 粗体可按大字算，勉强 |

把 `#94a3b8` 全部换成 `#64748b`、`#64748b` 在浅灰底上换成 `#475569`，禁用态文字换成 `#475569`，即可全部达标。

### 3.7 兼容性

- `<dialog>` 需要 Safari 15.4+ / Chrome 37+ / Firefox 98+；老 Android WebView（微信、QQ 浏览器的旧内核）没有 `showModal`，预览功能直接抛错。加一行 `if (typeof dialog.showModal !== 'function')` 回退到 `alert` 或内嵌展示。
- `navigator.clipboard` 在部分 WebView 为 `undefined`，目前只会提示失败。考虑到用户群在手机上传文件到手环，保留一个 `execCommand('copy')` 回退是务实的。
- `backdrop-filter` 缺少 `-webkit-` 前缀，iOS 17 以前的 Safari 没有毛玻璃。
- 数字输入框没有 `inputmode="numeric"` / `"decimal"`，手机不会弹数字键盘。
- `min-height: 100vh` 在移动端会被地址栏遮住底部，用 `100dvh` 并保留 `100vh` 作回退。

---

## 4. CSS

### 4.1 死代码（约 70 行）

- `.status-container` / `.status` / `.status.show` / `.status.success|error|info` / `.status-close`：JS 从不操作 `#status`，但 `.status-container { min-height: 50px; margin: 10px 0 }` 一直把「立即开始分割」按钮和结果区撑开约 70 px 空白。
- `.empty-state` / `.empty-state-icon` / `.sr-only`：HTML 和 JS 都没有用。
- `.progress-container { animation: fadeIn 0.3s ease }`（`index.html:466`）：全文没有 `@keyframes fadeIn`，这行等于没写。

### 4.2 性能相关

- 11 处 `transition: all`。`.file-item:hover { padding-left: 28px }` 配合 `transition: all` 让每个列表项 hover 时都做布局计算；5000 项时鼠标划过会掉帧。改成 `transition: background-color, transform` 并用内层 `transform: translateX()` 代替 padding。
- `* { font-family: 'Inter', ... }`：Inter 从未加载（离线），这个值永远落空；通配符还会覆盖 `<pre>`、`<input>`、`<button>` 的默认字体。应该写在 `body` 上，表单控件用 `font: inherit`。
- `.toast { pointer-events: all }`：`all` 是 SVG 专用值，HTML 上应为 `auto`（浏览器当作 `auto` 处理，但不规范）。
- `*:focus-visible { border-radius: 8px }`：给所有聚焦元素统一设圆角，会覆盖输入框原本的 10px。

### 4.3 可选

- 没有 `prefers-color-scheme: dark`。页面外层深色渐变、卡片纯白，夜间对比刺眼。变量都在 `:root` 里，加一个 media block 即可。
- `.container` 初始 `opacity: 0` 依赖动画 `forwards` 才可见。虽然 `prefers-reduced-motion` 块把时长设成 0.01ms 能完成，但任何导致动画不跑的情况（例如打印）都会得到空白页。更稳的做法是在 reduced-motion 下直接 `opacity: 1; animation: none`。

---

## 5. 第三方库与安全

### 5.1 内联库完整性 【已验证】

| 库 | 内联大小 | cdnjs 官方 | 比对结果 |
|---|---|---|---|
| JSZip 3.10.1 | 97642 B | 97630 B | 去除 CRLF / 首尾空白后逐字节一致 |
| FileSaver 2.0.5 | 2751 B | 2749 B | 同上 |

CHANGELOG 2.4.0 的"哈希与 cdnjs 官方 SRI 逐字校验一致"属实。建议在 `vendor/` 目录（见 §7.5）旁放一个 `VENDOR.md` 记录来源 URL 和 SHA-512，便于以后升级时复核。

### 5.2 建议加 CSP，把「不上传」变成浏览器强制

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
               img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">
```

`connect-src 'none'` 之后，即便将来代码被改坏或插入第三方脚本，也发不出任何网络请求。前提是去掉 §3.2 提到的内联 `onclick`（或加 `'unsafe-hashes'`）。

### 5.3 文件名进入 ZIP 前应清洗

`zip.file(f.name, f.blob)`：JSZip 把名字里的 `/` 当目录分隔符；Linux 上的 `File.name` 可以包含 `\`、`:` 等 Windows 非法字符，解压时会失败。`baseName.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')` 一行解决。

### 5.4 `saveBlob` 200 ms 撤销 URL

`index.html:1666`。iOS Safari / 微信的下载是异步的，200 ms 可能导致「下载失败」。FileSaver 用的是 40 s 并处理了 Safari 的特殊情况。既然已内联，直接 `saveAs(file.blob, file.name)`，删掉 `saveBlob`。

### 5.5 现有做法里值得保留的

XSS 防护（全部走 `textContent` / `setAttribute`）、扩展名校验、Toast 消息不走 HTML，这些都对。`splitFiles` 存的是 `File.slice()` 引用而不是拷贝，内存开销接近零，是正确的设计。

---

## 6. 性能

### 6.1 列表入场动画延迟随文件数线性增长

`index.html:1582`：`animationDelay = idx * 0.05s`，`.file-item` 初始 `opacity: 0`。200 份时最后一项 10 s 后才出现，5000 份要 250 s。`Math.min(idx, 20) * 0.05`，或超过 50 项关闭 stagger。

### 6.2 5000 份一次性建约 2.5 万个 DOM 节点

每个 `li` 四个子元素、两个监听器。用 `DocumentFragment` 一次插入；在 `<ul>` 上事件委托（一个 `click`，通过 `data-index` 找回 `splitFiles[i]`）；超过几百项时分页或虚拟列表。

### 6.3 ZIP 打包

- `generateAsync` 第二个参数是进度回调（`metadata.percent`），可以直接驱动现有进度条，目前打包几百 MB 时只有一个转圈。
- 默认 `compression: 'STORE'`，文本 `DEFLATE` 通常缩小 60% 以上，可作选项。
- JSZip 会把所有 Blob 读进内存，几百 MB 的书在手机上可能 OOM。超过阈值（如 200 MB）时提示优先单文件下载。README 里"支持任意大小"的说法在这里不成立。

### 6.4 `formatMB` 命名与实现

返回的可能是 KB，名字叫 `formatMB` 容易误导；建议 `formatBytes`，内部用 `Intl.NumberFormat`。

---

## 7. 工程与仓库

### 7.1 README 实际上是 CHANGELOG

`README.md` 第一行是 `## 📝 更新日志`，内容与 `CHANGELOG.md` 重复。真正的 README（项目简介、功能列表、小米手环场景、在线地址、徽章）在 commit `e2c547b`「更新2.2版本」时被整体覆盖，`c019efb` 还能看到完整版：

```bash
git show c019efb:README.md > README.md    # 然后更新版本号和功能项
```

另外：

- README 引用 `[MIT](LICENSE)`，仓库里没有 `LICENSE` 文件。
- README 第 102 / 120 / 175 行的 `&lt;dialog&gt;`、`&lt;p align="center"&gt;` 是 HTML 实体，在 Markdown 里会原样显示成 `&lt;`。

### 7.2 版本与 CHANGELOG 状态不一致

- `CHANGELOG.md` 的 `Unreleased` 段（BOM、按大小尾部、键盘冒泡三项修复）实际已经在 HEAD `0ed9237` 里，但 `<title>` 和 `<h1>` 仍是 v2.4.1。应发 2.4.2。
- 版本号在 `<title>` 和 `<h1>` 两处手工维护，建议一个 `const APP_VERSION` 或构建时注入。
- CHANGELOG 2.3.0 "点击遮罩"一项不实（§3.5）；2.3.0 "限制最多 3 条 Toast" 正是引入死循环的改动（§2.2）。

### 7.3 仓库里的非代码文件

- `index由Claude于2026年6月8日完成制作`：9 KB 的 WPS Office 复合文档（OLE2），0 字 0 页，无扩展名，被 git 跟踪。应是误提交，删除。
- `备份/` 下 7 个历史 HTML（约 230 KB）也在 git 里，其中 `index2.2.html` 和 `index_enhanced_Kimi.html` 逐字节相同。git 历史已经保存了它们，`git rm -r 备份` 并打 tag（`v1.0`、`v2.0`、`v2.1`、`v2.2`）替代。
- 近期提交信息「小改动」「修复bug」「更新」无法回溯改了什么；建议至少写清模块和动机。

### 7.4 单文件结构

160 KB 里 100 KB 是两行压缩库，`git diff`、搜索、编辑都很痛苦。在不放弃「单文件分发」的前提下：

```
src/index.html       模板，含 <!-- @inject:styles --> / <!-- @inject:app --> 占位
src/styles.css
src/app.js           应用逻辑（可用 <script type="module"> 获得严格模式和作用域隔离）
src/split-core.js    纯函数：computeChunkBoundaries(file, opts) → [[start,end],...]
vendor/jszip.min.js
vendor/FileSaver.min.js
vendor/VENDOR.md     来源 URL + SHA-512
build.mjs            零依赖 Node 脚本，拼出 dist/index.html，顺手注入版本号
tests/split.test.mjs node --test
```

`build.mjs` 二十行即可，不需要 npm 依赖，GitHub Pages 继续发布 `dist/index.html`（或构建后复制到根目录）。

### 7.5 测试

分割算法是整个项目唯一有算法含量的部分，却没有任何测试。本目录的 `split_core.mjs` 已经是从 `index.html` 逐字抽出的纯函数版本，补上这些样本即可成为 `node --test` 用例：

- UTF-8 带 BOM / 不带 BOM
- GBK
- 只有 `\r` 换行
- 单行超长（无换行）
- 空文件、1 字节文件
- 份数 > 字节数
- 按大小模式每份不超过上限
- 按份数模式实际份数 == 请求份数（当前会失败，见 §1.2）

### 7.6 杂项

- 三个文本文件工作区全是 CRLF，`.gitattributes` 的 `text=auto` 入库时转 LF。加 `.editorconfig`（`end_of_line = lf`、`charset = utf-8`、`indent_style = space`）避免编辑器来回改。
- 缺 `<meta name="description">`、`<meta name="color-scheme">`、favicon（GitHub Pages 上每次打开一个 404，可内联 `data:` SVG）。
- 全局作用域有 4 个 `let` 和十几个函数；`closePreview` 只因为内联 `onclick` 才必须是全局的。改 `type="module"` 后全部收进模块作用域。

---

## 8. 建议的修改顺序

| 阶段 | 内容 | 对应章节 |
|---|---|---|
| 1 | 重写切点算法为字节级向前扫描；捕获局部 `file` / `mode`；处理中禁用上传区和模式按钮；修 Toast 死循环 | §1.5, §2.1, §2.2 |
| 2 | 零风险清理：删 `#status` 块、死 CSS、`fadeIn`；修 `aria-describedby`；`clearInputErrors` 恢复文案；错误路径隐藏结果区；`showPreview` 加 try/catch | §4.1, §3.1, §2.3 |
| 3 | 体验：让出策略、stagger 上限、`saveAs` 替代 `saveBlob`、对比度、`inputmode`、`100dvh`、空文件/多文件/重选文件 | §1.6, §6.1, §5.4, §3.6, §3.7, §2.4 |
| 4 | 文档与仓库：恢复 README、补 LICENSE、修实体、删误提交文件和 `备份/`、发 2.4.2 | §7.1–7.3 |
| 5 | 工程化：拆 `src/` + `vendor/` + `build.mjs`，加 `node --test`，CSP | §7.4, §7.5, §5.2 |
| 6 | 产品：章节标题优先切点、GBK 预览、ZIP 进度与压缩、深色模式、方向键切 Tab | §1.5, §6.3, §4.3, §3.4 |

阶段 1 和 2 合计改动量不到 150 行，但解决了全部"已复现"的问题。
