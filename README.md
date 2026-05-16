## 📝 更新日志

### v2.2.1 (2026-05-16) — 潜在的bug

修复了issue1根因定位：这不是典型死循环。`for` 循环被 `partsCount` 限制，且最大 5000。卡在 issue 截图里的“正在分析文件...”阶段，是因为旧代码在第一次进度更新前执行：

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