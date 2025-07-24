## 这里是我的GitHub仓库，想直接访问我的txt-splitter吗？

[➡️ 点击这里立即体验 txt-splitter ⬅️](https://maple2085.github.io/txt-splitter/){: style="background-color: #2ea44f; color: white; padding: 8px 12px; border-radius: 6px; text-decoration: none;"}

---
---

## 项目概述

这是一个功能强大的TXT文件分割工具，允许用户通过两种方式分割文本文件：
1. 按份数分割（指定分成几部分）
2. 按大小分割（指定每部分的最大大小）

所有处理都在浏览器本地完成，文件不会上传到任何服务器，保障用户隐私安全。

## 核心功能

- **文件上传**：支持拖放上传或点击选择文件
- **分割模式选择**：
  - 按份数分割（默认分成3份）
  - 按大小分割（默认每份1MB）
- **多语言支持**：中文/英文界面切换
- **结果管理**：
  - 显示所有分割文件列表
  - 支持单独下载每个分割文件
  - 一键打包所有分割文件为ZIP下载
- **实时反馈**：操作状态提示和错误信息显示

## 使用说明

1. 点击上传区域或拖放TXT文件到指定区域
2. 选择分割模式（按份数或按大小）
3. 设置分割参数（份数或大小）
4. 点击"开始分割文本"按钮
5. 在结果区域查看生成的文件列表
6. 点击单个文件名下载该文件，或点击底部按钮下载所有文件的ZIP压缩包

## 使用政策摘要

### 用户责任
- 仅用于处理合法且符合道德规范的内容
- 对上传的文件内容负责，确保不含侵权、非法或有害信息
- 禁止用于任何违反法律法规的活动

### 隐私与数据保护
- **所有文件处理都在本地进行**，不会上传到任何服务器
- 不收集用户的个人信息或文件内容
- 用户完全控制自己的数据

### 版权声明
- 工具源代码、界面设计和功能均为原创
- 可自由使用但不可用于商业再分发或改编

### 免责声明
- 工具仅提供文本分割功能
- 开发者不对使用后产生的任何损失或损害承担责任
- 不保证在所有设备上完美运行

## 界面更新说明

### UI设计改进 🎨
- 现代化渐变色背景与卡片式设计
- 响应式布局适配各种设备尺寸
- 文件信息展示区域优化
- 交互状态视觉反馈（悬停、拖放等）

### 功能增强 ⚙️
- 文件分割模式切换（份数/大小）
- 文件大小智能格式化显示
- 操作结果列表清晰展示
- 一键打包下载功能

### 用户交互优化 🤖
- 拖放文件上传功能
- 操作状态实时提示（成功/错误）
- 分割参数即时验证
- 多语言无缝切换

### 性能优化 🚀
- 本地处理不依赖服务器
- 大文件处理能力优化
- 高效内存管理

## 使用示例

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>高级文本分割工具</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js"></script>
    <style>
        /* 样式代码已包含在HTML文件中 */
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1 id="title">高级文本分割工具</h1>
            <p id="description">拖放文本文件或点击上传区域选择文件</p>
            <div class="lang-switch">
                <button id="lang-zh" class="lang-btn active">中文</button>
                <button id="lang-en" class="lang-btn">English</button>
            </div>
        </header>
        
        <div class="upload-area" id="upload-area">
            <div class="upload-icon">📁</div>
            <h2 id="upload-text">拖放文件到此处</h2>
            <p id="upload-subtext">或点击选择文本文件 (.txt)</p>
            <input type="file" id="file-input" class="file-input" accept=".txt">
        </div>
        
        <!-- 文件信息、模式选择、操作按钮等 -->
        
        <script>
            // JavaScript功能代码已包含在HTML文件中
        </script>
    </div>
</body>
</html>
```

## 注意事项

1. 工具仅支持纯文本文件（.txt格式）
2. 按大小分割时，最小分割单位为0.1MB
3. 分割后的文件名格式为：pX_原文件名.txt（X为分割序号）
4. 大文件处理可能需要一些时间，请耐心等待

## 反馈与支持

如有任何问题或建议，请联系开发者。我们将持续改进工具，提供更好的用户体验。

感谢您使用TXT文件分割工具！

---

## 项目灵感与致谢

- **灵感来源**：  
  本项目灵感源于 [@lixuan5201314](https://github.com/lixuan5201314/lixuan5201314) 的创意作品

  关于 @lixuan5201314 的 [米坛原帖](https://www.bandbbs.cn/resources/2734/)

- **设计理念**：  
  在参考原项目的基础上，本工具聚焦核心功能优化，采用现代设计语言，实现更简洁美观的界面呈现

- **开发支持**：  
  开发过程中使用了 `ChatGPT`、`DeepSeek`、`Grok` 等 AI 辅助工具进行代码实现

---

## 附：项目开发背景 - 小米手环电子阅读器支持

本项目的开发初衷是为了解决小米手环电子阅读器（如[环间电子书](https://b23.tv/94Wv5Un)和[喵喵电子书](https://b23.tv/9BmBcpb)）上的文件大小限制问题。

由于小米手环的存储限制，单本电子书文件不能超过 **4MB**。然而，大多数长篇文本文件（尤其是完整的电子书）往往超过这一限制。因此，我开发了这款文本分割工具，专门用于将超限的TXT文档分割成符合手环要求的合理大小文件。

> **关键价值点**：
> - 解决小米手环4MB文件大小限制问题
> - 确保长篇电子书可以在手环上分段阅读
> - 保持文本完整性，避免内容截断

---

# 作者浅喵：

我的小米手环9在传txt时偶尔会重启……然后传输就失败了。

但翻了一下bilibili，有人说：只要传txt的时候不超过2mb，就不会重启

（虽然说我没试过，但是我传的书好像普遍都超过2mb……？）
