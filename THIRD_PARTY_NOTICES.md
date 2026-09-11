# 第三方组件

本项目使用以下组件，发行目录保留其随附许可证：

| 组件 | 用途 | 许可证文件 |
| --- | --- | --- |
| Mozilla Readability | 当前网页正文提取 | [extension/vendor/Readability.LICENSE.md](extension/vendor/Readability.LICENSE.md) |
| Lucide | 界面图标 | [extension/vendor/lucide.LICENSE](extension/vendor/lucide.LICENSE) |

构建使用的 Lucide 副本与许可证还保存在 `preview/vendor/`。Python 服务的依赖由 `server/requirements.txt` 声明，通过包管理器安装，未把整个 Python 环境放进源码发行包。

`extension/icons/` 中的 PNG 图标由 Lucide Bird 图形渲染，相关许可见上表的 Lucide 许可证；生成脚本为 `scripts/build-icons.cjs`。

第三方组件的许可证不自动适用于本仓库自有代码，自有代码的权利声明也不限制第三方许可证授予的权利。

## 自有代码

本项目自有代码采用“源码公开，保留权利”发布，允许个人下载、安装及本地运行所必需的复制，其余权利保留。完整范围及适用法律、GitHub 平台条款的例外见 [README 的版权与使用边界](README.md#版权与使用边界)。本声明不采用开源许可证，不覆盖第三方组件自身的许可。
