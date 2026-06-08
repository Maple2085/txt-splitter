## 📝 更新日志

本项目所有重要变更都会记录在此文件中。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
- 打包下载改为 `async/await`，新增"打包中"加载态与失败兜底提示。

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
  同时限制最多同时显示 3 条通知。

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

---

### v2.2.1 (2026-05-16) — 潜在的bug

修复了[issue#1](https://github.com/Maple2085/txt-splitter/issues/1)根因定位：这不是典型死循环。`for` 循环被 `partsCount` 限制，且最大 5000。卡在 issue 截图里的“正在分析文件...”阶段，是因为旧代码在第一次进度更新前执行：

`await windowBlob.text()`

如果移动端浏览器/文件提供器上的 sliced `Blob.text()` 抛错或不返回，`processSplit()` 没有 `catch/finally`，按钮、骨架屏、进度条都不会恢复，于是表现为“分割过程无法结束”。截图停在 0% 前，和这个路径吻合。

我已修改了：

- 新增 `readBlobAsText()`，用 `FileReader` 读取小窗口 slice，并加 15 秒超时。
- 将 split 主循环里的 `windowBlob.text()` 替换为该 helper。
- 给 split 处理段加 `try/catch/finally`，保证失败或超时时退出处理中状态。
- 对换行切点增加 `safeChunkEnd > currentOffset` 防护，避免边界计算导致不推进。

验证结果：

- 用 issue 截图参数规模，132KB / 3 份，核心循环本身会结束。
- 复现旧代码读取失败路径：状态停在 `disabled=true`、`progress="正在分析文件..."`、`skeleton=true`。
- 补丁后同样失败会恢复按钮、隐藏骨架屏，并提示“分割失败”。
- 脚本语法检查通过；`git diff --check` 只有 CRLF 换行提示。

---

### v2.2 (2026-05-04) — 可访问性与动画增强版

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
- `&lt;dialog&gt;` + `textContent` 替代 `window.open` + `document.write`，彻底消除 XSS
- `navigator.clipboard.writeText()` 替代废弃 `execCommand('copy')`

**⚡ 性能优化**
- `Blob.slice()` 替代 `FileReader.readAsText()`，100MB+ 文件不卡死
- 每次循环无条件让出主线程，进度条实时更新

**🐛 Bug 修复**
- 显式输入边界校验（份数 1-5000、大小 ≥0.01），超限聚焦报错
- 分割前重置 `splitFiles` 数组和列表 DOM，防止旧结果累积
- 防抖输入（150ms）避免频繁重计算

---

### v2.1.1 (2026-03-08) — 安全与性能优化版

**🛡️ 安全修复**
- MIME 类型校验：不仅校验后缀，还校验 MIME 类型，防止恶意改名
- Dialog 弹窗：使用原生 `&lt;dialog&gt;` 元素替代 `window.open`，防止被浏览器拦截
- XSS 防护：预览内容使用 `textContent` 替代 `innerHTML`，防止脚本注入

**⚡ 性能优化**
- Blob 游标切片：抛弃 `readAsText` 读全文，改用基于 File 的 Blob 切片，避免大文件内存溢出
- 智能断点：寻找切点附近的换行符边界，防止切断中文或切断句子
- UTF-8 安全解码：`blob.text()` 安全按 UTF-8 解码，不会产生截断乱码

**🐛 Bug 修复**
- 数组堆积：提早清空旧结果，防止多次点击导致数组不断 Push 堆积
- Clipboard API：抛弃废弃的 `execCommand`，升级为异步现代 Clipboard API

---

### v2.1 (2026-03-08) — 初始优化版
- ✨ 优化智能进度条显示

---

### v2.0 — 初始版本

v2.0 存在以下已知问题，已在后续版本修复：

**Bug（3 项）**
- ~~文本按字符切割，中文会断行乱码~~ ✅ 已修复（v2.1.1）
- ~~previewText 未转义 HTML，存在 XSS~~ ✅ 已修复（v2.1.1）
- ~~execCommand('copy') 已废弃~~ ✅ 已修复（v2.1.1）

**性能（2 项）**
- ~~FileReader 将整个文件读入内存~~ ✅ 已修复（v2.1.1）
- ~~UI 让出时机过于保守（每 10 份才让出一次）~~ ✅ 已修复（v2.1.1）

**UX（3 项）**
- ~~分割完成后结果区不清空，新结果追加在旧结果后~~ ✅ 已修复（v2.1.1）
- ~~弹窗预览被拦截器阻断~~ ✅ 已修复（v2.1.1）
- ~~输入框缺少边界校验与错误提示~~ ✅ 已修复（v2.2）

**安全（2 项）**
- ~~previewText XSS（同 Bug 区）~~ ✅ 已修复（v2.1.1）
- ~~仅校验扩展名，未校验 MIME 类型~~ ✅ 已修复（v2.1.1）

---

## 🤝 致谢

- **灵感来源**：[@lixuan5201314](https://github.com/lixuan5201314/lixuan5201314)
- **原帖参考**：[米坛社区](https://www.bandbbs.cn/resources/2734/)
- **开发支持**：`Gemini` `Kimi` 等 AI 辅助工具

---

## 📄 许可证

[MIT](LICENSE)

&lt;p align="center"&gt;Made with ❤️ for 小米手环阅读爱好者&lt;/p&gt;
