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