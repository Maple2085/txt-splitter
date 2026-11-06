# 更新日志

本项目所有重要变更都会记录在此文件中。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [2.5.0] - 2026-10-01

以代码审查报告（`review/REVIEW.md`）为依据的整体修复版本。核心是重写切分算法，
并补齐此前缺失的测试与工程化设施。

### 修复

- **按大小分割时换行对齐完全失效**：旧实现把搜索窗口取在切点前后各 2560 字节，
  并选用窗口内最后一个换行，导致该位置几乎总是越过每份大小上限而被拒绝，
  最终退回字符边界。结果是按大小分割的每一份都切在行中间——而这正是
  小米手环 2MB 限制场景所使用的主路径。
- **按份数分割的实际份数远少于请求**：同一个"向后取换行"的策略会让每一份都比
  目标大出最多约 2.5KB，1MB 文件请求 5000 份时只得到 385 份。现在当第 i 段的
  切点被吸附时，会保证给后续每一段留下至少 1 个字节，实际份数与请求严格一致。
- **GBK/GB2312 文件被切在汉字中间**：旧实现把字节按 UTF-8 解码、找到换行后再用
  `TextEncoder` 回算字节偏移。GBK 字节会产生大量 `U+FFFD`，回算结果比窗口尾部
  还多出近万字节，且仍满足上限校验而被采用。现在全程在字节层面扫描 `0x0A`/`0x0D`，
  不经过解码，对所有单字节编码都精确。
- **Toast 超过 3 条时页面死循环**：`removeToast()` 只是启动一个 300ms 后生效的
  退场动画，而 `while (children.length >= MAX_TOASTS)` 依赖它同步减少子节点数，
  条件恒真导致主线程冻结。连续点 4 次「复制」即可复现。现在只统计尚未进入退场
  动画的通知。
- **处理过程中切换模式或更换文件会污染结果**：分割循环直接读取全局的
  `currentMode` 与 `selectedFile`（循环体内共 11 处）。现在开始时把文件、模式、
  参数、编码快照为局部变量，并在处理期间禁用上传区、模式按钮与输入框。
- **预览对 GBK 文件显示乱码**：`Blob.text()` 固定按 UTF-8 解码。现在按探测到的
  编码解码，并且「前 1000 字符」名副其实（旧实现实际是 1000 字节）。
- **分割失败后结果区仍然显示**：`catch` 分支只清空数组，UI 收尾不完整，用户会看到
  一个空列表和可点击的打包按钮。现在失败时隐藏结果区。
- **预览功能没有错误处理**：`slice.text()` 抛错时会变成未捕获的 Promise 拒绝。
  现在有兜底提示，并在缺少 `<dialog>` 的老 WebView 上回退到 `alert`。
- **输入校验的提示文案无法恢复**：`clearInputErrors()` 只移除 `error-text` 类，
  不还原文本，触发一次错误后原始提示（「请输入 1-5000 之间的整数」）永久丢失。
- **键盘操作复制/预览会触发下载**：列表项的 `keydown` 需要判断 `e.target`，
  v2.4.1 已修，本次改为事件委托后该问题不复存在。
- 空文件（0 字节）此前会显示一个空结果区，现在直接拒绝并提示。
- 同一个文件无法重新选择：现在每次选择后重置 `input.value`。
- `saveBlob()` 在 200ms 后即撤销 Object URL，在 iOS Safari 与微信内置浏览器中
  可能导致下载失败；改用已内联的 FileSaver。

### 变更

- **切分算法重写为纯函数模块**（`src/split-core.js`）：接收 `Blob` 与参数，
  返回 `[start, end)` 边界数组，不依赖 DOM，可直接单元测试。
- **新增编码探测**：识别 UTF-8（带/不带 BOM）、纯 ASCII、GBK/Big5、
  UTF-16 LE/BE，结果在文件信息处显示。
- **新增切分位置偏好**：智能（优先「第 X 章」等章节标题）、仅按换行、严格按字节。
- **新增停止分割**：长时间任务可中止。
- **新增深色模式**：跟随系统 `prefers-color-scheme`，色值统一收敛为语义变量。
- **新增大列表分页**：超过 200 项时只渲染前 200 项并提供「展开剩余」，
  渲染改用 `DocumentFragment` + 事件委托（此前 5000 项会创建约 2.5 万个节点
  和 1 万个监听器）。
- **主线程让出改为按时间**：旧实现每轮 `setTimeout(0)`，浏览器对嵌套定时器
  从第 5 层起钳制到 4ms，5000 轮纯等待超过 20 秒。现在每 16ms 让出一次，
  并优先使用 `scheduler.yield()`。
- **列表入场动画延迟设上限**：旧实现按 `idx * 0.05s` 线性增长，200 项时最后一项
  要 10 秒后才可见。
- **ZIP 打包改为 DEFLATE 压缩并显示进度**：此前是 STORE（不压缩）且只有转圈。
- **无障碍改进**：修正 `aria-describedby` 指向不存在的 id（旧实现误用了类名）；
  Toast 的 `aria-live` 移到常驻容器上（动态插入带内容的 live region 通常不会被播报）；
  错误类通知改用 `role="alert"`；Tab 组支持方向键切换；上传区内的标题元素改为
  普通段落（按钮内出现标题会导致重复播报）。
- **对比度修正**：文件大小、输入提示、禁用按钮等 4 处不满足 WCAG AA。
- **输入框补充 `inputmode`**，移动端可弹出数字键盘。
- **iOS 兼容**：`backdrop-filter` 补 `-webkit-` 前缀，`min-height` 补 `100dvh`。
- `select`/`input` 不再受通配符字体规则影响，字体声明移到 `body`。
- `transition: all` 全部替换为显式属性，列表项 hover 不再改 padding（避免重排）。

### 新增

- **`review/REVIEW.md`**：完整代码审查报告（含复现脚本）。
- **`tests/`**：34 项 `node:test` 单元测试，覆盖 GBK、UTF-16、CR/CRLF、
  空文件、单行超长、份数边界、换行对齐回归等场景。
- **`tools/browser-check.mjs`**：基于 CDP 的无头浏览器端到端检查（42 项断言），
  覆盖 DOM 装配、事件绑定、CSP、深色模式、端到端分割与打包。
- **`build.mjs`**：零依赖构建脚本，把 `src/` 与 `vendor/` 拼回单文件 `index.html`。
- **`package.json`**、`.editorconfig`、`LICENSE`（此前 README 引用了不存在的 LICENSE）。
- **CSP**：`connect-src 'none'` 等策略，从浏览器层面保证「不上传」。
- **favicon**：内联 SVG，消除 GitHub Pages 上的 404。

### 移除

- 不再写入的 `#status` 状态区（HTML、CSS、约 70px 的空白占位）。
- 未使用的 CSS：`.empty-state`、`.empty-state-icon`、`.sr-only`、`.status-close`。
- 引用但从未定义的 `@keyframes fadeIn` 已补上定义。
- 仓库中的非代码文件：无扩展名的 WPS 文档 `index由Claude于2026年6月8日完成制作`，
  以及 `备份/` 目录（7 个历史版本 HTML 中已有一对完全相同，
  且 git 历史本身已保存全部版本）。

### 文档

- `README.md` 恢复为项目介绍（在 `e2c547b`「更新2.2版本」时被更新日志覆盖，与
  `CHANGELOG.md` 重复；原内容可在 `git show c019efb:README.md` 取回）。
- 修正 README 中 `&lt;dialog&gt;` 之类的 HTML 实体，使其正常显示。
- 更正 CHANGELOG 中「点击遮罩关闭」的描述——该行为现已真正实现。

## [2.4.1] - 2026-06-08

### 优化

- **分块序号零填充**：文件命名宽度现在依据*实际生成的文件数*动态补零，
  避免在文件管理器中出现 `P1, P10, P2…` 的排序错乱。
  - 9 个 → `P1 … P9`（不补零）
  - 10 个 → `P01 … P10`
  - 100 个 → `P001 … P100`
  - 5000 个 → `P0001 … P5000`
  - 补零宽度按真实数量计算（空块会被跳过、文件读完会提前结束，
    实际数量可能少于预估份数），命名延后到分割循环结束后统一处理。

## [2.4.0] - 2026-06-08

### 变更

- **完全离线化**：内联 JSZip 3.10.1 与 FileSaver 2.0.5，不再从 CDN 动态加载。
  断网可用、无供应链风险、单文件即可分发（哈希与 cdnjs 官方 SRI 逐字校验一致）。
- 打包下载改为 `async/await`，新增“打包中”加载态与失败兜底提示。

### 移除

- 删除 `loadScript` 动态加载逻辑及相关 SRI 配置（已内联，无需校验）。

## [2.3.0] - 2026-06-08

### 安全

- **修复 XSS 漏洞**：文件名不再经 `innerHTML` 注入，列表项改用
  `createElement` + `textContent`/`setAttribute` 构建，恶意文件名无法执行脚本。
- **为 CDN 脚本增加 SRI 校验**：JSZip / FileSaver 加载时校验 `integrity`，
  防止 CDN 被投毒后执行任意代码。*(注：v2.4.0 已改为内联，此项随之移除)*

### 修复

- **修复 UTF-8 多字节字符被切断**：无可用换行点时回退对齐到字符边界，
  避免边界处出现乱码 `�`。
- **修复预览对话框焦点丢失**：关闭后焦点归还到触发按钮，统一在 `<dialog>`
  的 `close` 事件处理，覆盖 ESC / 关闭按钮 / 点击遮罩等所有关闭路径。
- **修复 Toast 内存泄漏**：移除只增不减的计时器数组，计时器随节点移除一并清理；
  同时限制最多同时显示 3 条通知。*(注：该限制的实现在 v2.5.0 被发现会导致死循环)*

### 优化

- **提升分割读取性能**：以 `Blob.arrayBuffer()` + `TextDecoder` 替代 `FileReader`，
  以 `TextEncoder` 替代 `new Blob([]).size` 计算字节长度。

### 变更

- 放宽文件类型校验：以扩展名 `.txt` 为准，兼容不同系统对 MIME 的不一致上报。

### 移除

- 清理冗余代码：删除废弃的 `readBlobAsText`、`showMsg` 兼容垫片、
  未使用的全局变量，以及原生 `<button>` 上多余的 Enter/Space 键盘监听。

### 杂项

- 修正动画命名 `slideInRight` → `slideInLeft`（实际从左侧滑入）。

## [2.2.1] - 2026-05-16

修复 [issue #1](https://github.com/Maple2085/txt-splitter/issues/1)：这不是典型死循环。
`for` 循环被 `partsCount` 限制，且最大 5000。卡在 issue 截图里的“正在分析文件...”阶段，
是因为旧代码在第一次进度更新前执行 `await windowBlob.text()`；如果移动端浏览器/文件
提供器上的 sliced `Blob.text()` 抛错或不返回，`processSplit()` 没有 `catch/finally`，
按钮、骨架屏、进度条都不会恢复，于是表现为“分割过程无法结束”。

修复内容：

- 新增 `readBlobAsText()`，用 `FileReader` 读取小窗口 slice，并加 15 秒超时。
- 将 split 主循环里的 `windowBlob.text()` 替换为该 helper。
- 给 split 处理段加 `try/catch/finally`，保证失败或超时时退出处理中状态。
- 对换行切点增加 `safeChunkEnd > currentOffset` 防护，避免边界计算导致不推进。

## [2.2] - 2026-05-04

可访问性与动画增强版。

**🎨 动画与交互**
- Spring 物理曲线动画系统（`spring-bounce` / `spring-smooth` / `spring-exit` / `ease-out-expo`）
- 骨架屏（处理期间脉动占位）+ Stagger 列表入场动画
- Toast 通知系统（右上角堆叠，弹性进入/退出）
- 按钮涟漪效果、进度条光泽扫过、输入框错误抖动

**♿ 可访问性**
- 完整 ARIA 语义化（`role`、`aria-label`、`aria-live`、`aria-selected` 等）
- 键盘全导航（Tab 聚焦、Enter/Space 激活、ESC 关闭 Dialog）
- 高对比度焦点环 + 焦点管理（Dialog 开关自动转移焦点）
- `prefers-reduced-motion` 尊重用户减少动画偏好

**🛡️ 安全修复**
- MIME 类型 + 后缀双重校验，防止恶意文件改名上传
- `<dialog>` + `textContent` 替代 `window.open` + `document.write`，彻底消除 XSS
- `navigator.clipboard.writeText()` 替代废弃 `execCommand('copy')`

**⚡ 性能优化**
- `Blob.slice()` 替代 `FileReader.readAsText()`，100MB+ 文件不卡死
- 每次循环无条件让出主线程，进度条实时更新

**🐛 Bug 修复**
- 显式输入边界校验（份数 1-5000、大小 ≥0.01），超限聚焦报错
- 分割前重置 `splitFiles` 数组和列表 DOM，防止旧结果累积
- 防抖输入（150ms）避免频繁重计算

## [2.1.1] - 2026-03-08

安全与性能优化版。

**🛡️ 安全修复**
- MIME 类型校验：不仅校验后缀，还校验 MIME 类型，防止恶意改名
- Dialog 弹窗：使用原生 `<dialog>` 元素替代 `window.open`，防止被浏览器拦截
- XSS 防护：预览内容使用 `textContent` 替代 `innerHTML`，防止脚本注入

**⚡ 性能优化**
- Blob 游标切片：抛弃 `readAsText` 读全文，改用基于 File 的 Blob 切片，避免大文件内存溢出
- 智能断点：寻找切点附近的换行符边界，防止切断中文或切断句子
- UTF-8 安全解码：`blob.text()` 安全按 UTF-8 解码，不会产生截断乱码

**🐛 Bug 修复**
- 数组堆积：提早清空旧结果，防止多次点击导致数组不断 Push 堆积
- Clipboard API：抛弃废弃的 `execCommand`，升级为异步现代 Clipboard API

## [2.1] - 2026-03-08

- ✨ 优化智能进度条显示

## [2.0]

初始版本。已知问题均已在后续版本修复：

**Bug**
- ~~文本按字符切割，中文会断行乱码~~ ✅ 已修复（v2.1.1）
- ~~previewText 未转义 HTML，存在 XSS~~ ✅ 已修复（v2.1.1）
- ~~execCommand('copy') 已废弃~~ ✅ 已修复（v2.1.1）

**性能**
- ~~FileReader 将整个文件读入内存~~ ✅ 已修复（v2.1.1）
- ~~UI 让出时机过于保守（每 10 份才让出一次）~~ ✅ 已修复（v2.1.1）

**UX**
- ~~分割完成后结果区不清空，新结果追加在旧结果后~~ ✅ 已修复（v2.1.1）
- ~~弹窗预览被拦截器阻断~~ ✅ 已修复（v2.1.1）
- ~~输入框缺少边界校验与错误提示~~ ✅ 已修复（v2.2）

**安全**
- ~~previewText XSS（同 Bug 区）~~ ✅ 已修复（v2.1.1）
- ~~仅校验扩展名，未校验 MIME 类型~~ ✅ 已修复（v2.1.1）
