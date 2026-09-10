# 第三方组件

本项目使用以下组件，发行目录保留其随附许可证：

| 组件 | 用途 | 许可证文件 |
| --- | --- | --- |
| Mozilla Readability | 当前网页正文提取 | [extension/vendor/Readability.LICENSE.md](extension/vendor/Readability.LICENSE.md) |
| Lucide | 界面图标 | [extension/vendor/lucide.LICENSE](extension/vendor/lucide.LICENSE) |

构建使用的 Lucide 副本与许可证还保存在 `preview/vendor/`。Python 服务的依赖由 `server/requirements.txt` 声明，通过包管理器安装，未把整个 Python 环境放进源码发行包。

第三方组件的许可证不自动适用于本仓库自有代码。自有代码的开源许可证尚待项目所有者确定。
