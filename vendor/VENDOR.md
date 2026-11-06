# vendor/ —— 内联的第三方库

产物 `index.html` 不引用任何外部资源。这两个文件在构建时被内联进 `<script>` 块，
使页面在断网、`file://` 直开、以及 GitHub Pages 等任何环境下都可完整运行。

## 来源与校验

| 文件 | 版本 | 来源 | 大小 | sha512 |
|:---|:---|:---|---:|:---|
| `jszip.min.js` | 3.10.1 | <https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js> | 97630 B | `wHRMTKE9DeA/ABED4atT15OOBRSbJ23YjbUU4+qyMrW8fJVbN6vlSQcn/tAHKEWM9khVpoca7CL8T4mGmcUqHg==` |
| `FileSaver.min.js` | 2.0.5 | <https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js> | 2749 B | `owKtIG794frIUBf7y//JHQSdLzuYiCLCGr+j9e7Bu3AQP/z/MP4IlGgXVFr/8CKBPD9F9Qkq252uGbDB17M6eQ==` |

本地文件比上游多 1 字节：入库时统一补了结尾换行（见 `.editorconfig`）。
去除换行与 CRLF 差异后，内容与 cdnjs 官方文件逐字节一致。

校验命令：

```bash
curl -s https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js | sha512sum
sha512sum vendor/jszip.min.js     # 结果应与上表一致（注意末尾换行差异）
```

## 升级步骤

1. 从 cdnjs 下载新版本，替换对应文件。
2. 用上表的方式重新计算 sha512，更新本文件。
3. 确认文件内不含 `</script`（构建脚本会检查并报错）。
4. `node build.mjs && node --test tests/*.test.mjs && node tools/browser-check.mjs`。

## 版本选择说明

- **JSZip 3.10.1** —— 打包下载。构建时以 `DEFLATE` 压缩，文本通常可缩小 60% 以上。
- **FileSaver 2.0.5** —— 触发下载。相比手写 `<a download>` + `URL.revokeObjectURL`，
  它正确处理了 Safari / iOS 的异步下载行为（手写版本若过早撤销 URL 会导致下载失败）。

两者都是 MIT 许可，许可证头保留在各自文件内。
