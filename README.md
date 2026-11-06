# 📄 TXT 文本分割工具

<p align="center">
  <img src="https://img.shields.io/badge/version-2.5.0-blue.svg?style=for-the-badge" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green.svg?style=for-the-badge" alt="License">
  <img src="https://img.shields.io/badge/platform-Web-orange.svg?style=for-the-badge" alt="Platform">
</p>

<p align="center">
  <b>纯浏览器端处理，快速分割大型 TXT 文件，完美解决小米手环等设备的文件大小限制问题</b>
</p>

<p align="center">
  <a href="https://maple2085.github.io/txt-splitter/"><img src="https://img.shields.io/badge/🚀_在线体验-点击访问-4361ee?style=for-the-badge" alt="Online Demo"></a>
</p>

---

## ✨ 功能特性

- **🔒 纯本地处理** — 所有操作在浏览器内完成，文件不出本机，代码层面的 CSP 也禁止任何网络请求
- **📊 双模式分割** — 支持按份数分割或按文件大小（MB）分割
- **🔤 智能编码识别** — 自动识别 UTF-8（带/不带 BOM）、GBK、Big5、UTF-16 LE/BE，中文不再乱码
- **✂️ 切点智能化** — 按字节扫描换行符，可选优先切在「第 N 章」这类章节标题前，绝不断开多字节汉字
- **⚡ 实时进度** — 分割过程可视化进度条，大文件处理不焦虑，随时可停止
- **📋 智能预估** — 分割前自动计算预估份数和单文件大小，参数超限即时提示
- **🔍 内容预览** — 按实际编码预览分割结果（前 1000 个字符），确认切点是否合适
- **📦 批量下载** — 支持打包为 ZIP（DEFLATE 压缩，带进度）或单独下载每个文件
- **📱 响应式设计** — 适配桌面端和移动端，跟随系统深色模式
- **♿ 无障碍支持** — 完整 ARIA 语义、键盘全导航、屏幕阅读器播报、尊重减少动效偏好

---

## 🎯 使用场景

### 小米手环电子书阅读

专为解决小米手环电子阅读器的 **4MB 文件大小限制** 设计（实际建议 **2MB** 以内更稳定）：

- 将超限的 TXT 电子书分割成符合手环要求的小文件
- 确保长篇电子书可以分段阅读
- 保持文本完整性，避免内容截断或汉字被切成两半

> 💡 **实测建议**：小米手环 9 传输 TXT 时，文件控制在 2MB 以内可显著降低重启概率。

---

## 🚀 快速开始

### 在线使用（推荐）

直接访问：<https://maple2085.github.io/txt-splitter/>

### 本地使用

直接用浏览器打开 `index.html` 即可，无需安装任何依赖、无需构建。

---

## 📖 使用指南

### 1. 上传文件

- 点击上传区域或拖放 TXT 文件至页面
- 自动识别文件编码并显示在文件信息处

### 2. 选择分割模式

| 模式 | 说明 | 适用场景 |
|:---|:---|:---|
| **按份数分割** | 将文件平均分成 N 份 | 已知需要分成几段 |
| **按大小分割** | 每份指定最大 MB 数 | 有明确的单文件大小限制（如 2MB） |

### 3. 选择优先切分位置

| 选项 | 说明 |
|:---|:---|
| **智能（优先章节标题）** | 尽量切在「第 X 章」这类标题之前，最贴近阅读习惯 |
| **仅按换行** | 只保证不切断行和多字节字符 |
| **严格按字节** | 不做任何调整，速度最快，可能切断多字节字符 |

### 4. 设置参数并执行

- 系统会实时显示预估结果：*"预估 5 份 · 每份约 2.14 MB · UTF-8"*
- 点击「立即开始分割」，大文件会显示实时进度，可随时点「停止分割」

### 5. 下载文件

- **单独下载**：点击列表中的任意文件名
- **批量下载**：点击「打包下载全部 (.ZIP)」
- **复制文件名**：点击 📋 按钮（便于批量重命名管理）

---

## 🔧 开发

源码按职责拆分，构建脚本把它们拼回单文件产物：

```
src/
  index.html      模板，含 /* @inject:xxx */ 占位符
  styles.css      样式（含深色模式）
  split-core.js   分块算法，纯函数、无 DOM 依赖
  app.js          界面逻辑
vendor/           内联的第三方库（JSZip 3.10.1、FileSaver 2.0.5）
tests/            node:test 单元测试
tools/            开发辅助脚本
build.mjs         零依赖构建脚本
index.html        构建产物（发布用，勿直接编辑）
```

```bash
node build.mjs              # 生成 index.html
node build.mjs --check      # 校验产物与源码是否一致
node --test tests/*.test.mjs
node tools/browser-check.mjs   # 无头浏览器端到端检查（需本机有 Chrome/Edge）
```

`split-core.js` 用 ESM 编写以便单元测试直接 import 真实源码；构建时会剥离
`import` / `export`，让两个文件在产物中处于同一作用域。

---

## 🛠️ 技术实现

- **纯前端架构** — HTML5 + CSS3 + Vanilla JavaScript，零后端依赖、零运行时依赖
- **字节级切分** — 直接在 `Blob` 切片上扫描 `0x0A` / `0x0D`，不解码也不回编码，
  因此对 UTF-8、GBK、Big5、UTF-16 都成立；只读取切点附近的几 KB 窗口
- **流式处理** — 不把整个文件读入内存，`File.slice()` 是惰性引用
- **时间片让出** — 按时间（16ms）而非按次数让出主线程，优先使用 `scheduler.yield()`
- **完全离线** — JSZip 与 FileSaver 内联，断网可用；CSP 设 `connect-src 'none'` 兜底
- **安全** — 文件名与消息一律走 `textContent`，ZIP 文件名做非法字符清洗
- **可访问性** — 列表用事件委托，键盘与屏幕阅读器全流程可用

---

## 🌟 界面预览

```
┌─────────────────────────────────────┐
│  📄 文本分割工具 v2.5.0              │
│                                     │
│  [拖放或点击上传 .txt 文件]           │
│                                     │
│  [按份数分割] [按大小分割]            │
│                                     │
│  分割成多少份？ [ 3 ]                │
│                                     │
│  优先切分位置：○智能 ○换行 ○严格      │
│                                     │
│  预估 3 份 · 每份约 1.50 MB · UTF-8  │
│                                     │
│  [    立即开始分割    ]              │
│                                     │
│  ─────── 分割结果预览 ───────        │
│  📄 P1_小说名.txt    📋 🔍 1.50 MB  │
│  📄 P2_小说名.txt    📋 🔍 1.48 MB  │
│  📄 P3_小说名.txt    📋 🔍 1.52 MB  │
│                                     │
│  [   打包下载全部 (.ZIP)   ]         │
└─────────────────────────────────────┘
```

---

## 🤝 致谢与灵感

- **灵感来源**：[@lixuan5201314](https://github.com/lixuan5201314/lixuan5201314)
- **原帖参考**：[米坛社区](https://www.bandbbs.cn/resources/2734/)
- **开发支持**：`Claude` `Gemini` `Kimi` 等 AI 辅助工具

---

## 📄 许可证

[MIT](LICENSE)

---

<p align="center">
  Made with ❤️ for 小米手环阅读爱好者
</p>
