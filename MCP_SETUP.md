# 拾集 · 飞鸽 MCP 接入

## 已实现

扩展确认发送 -> 本地 HTTP 保存 -> MCP 工具读取同一份快照 -> 扩展显示读取回执。
扩展不调用大模型，不会自动向当前聊天窗口发送消息；Agent 需要主动调用 MCP 工具。

## 启动本地服务

Windows 可直接双击项目根目录 `start-feige.cmd`。出现服务启动信息后保持窗口打开；关闭窗口或按 Ctrl+C 会停止服务。已有服务时脚本不会重复启动。

在解压或克隆后的项目根目录（包含 `server/` 的目录）执行：

```powershell
python -m pip install -r server/requirements.txt
python -m server.run
```

地址固定为 `127.0.0.1:8766`。不使用 `0.0.0.0`、多个 worker 或公网转发。数据仅在内存中，服务重启即清空。

## 连接 Agent

支持 Streamable HTTP 的 Agent 配置一个名为 `feige` 的 MCP 服务，URL：

```text
http://127.0.0.1:8766/mcp
```

Codex 的配置示例（合并到已有配置，不覆盖其他配置）：

```toml
[mcp_servers.feige]
url = "http://127.0.0.1:8766/mcp"
enabled_tools = ["get_selected_context", "get_page_outline"]
```

参考：[Codex 官方 MCP 配置](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。配置只在执行它的用户设备上生效，下载项目不会自动注册工具。若使用 Codex CLI，也可执行 `codex mcp add feige --url http://127.0.0.1:8766/mcp`；已有同名配置时先核对，不重复添加。上述 TOML 是仅开放读取工具的示例，CLI 默认注册全部三个工具。

完成配置后按所用客户端的要求重新加载或重启，并确认工具列表实际出现 `get_selected_context`。若仍未出现，应检查客户端连接错误、使用的配置和服务状态；不能用反复重启替代诊断。当前项目已通过官方 Python MCP 客户端联调，开发会话的原生 Codex 工具加载仍未完成验收。

服务另提供 `clear_context`，会删除当前本地服务的全部快照。仅在明确需要清空时调用。

## 人工验收

1. 在 Chrome/Edge 扩展管理页重新加载 `extension/`，刷新普通 HTTP(S) 网页，再点击飞鸽工具栏图标。
2. 分别拾取两条文字，编辑或脱敏，填写各自的选取目的、任务要求和回复语言，再加入收集箱。在收集箱保存默认语言与可选整体要求，点击“发送选中”；应出现“已保存 · 等待 MCP 读取”。
   面板随后显示“在 Agent 中读取”，点击复制图标，把包含本次 context_id 的提示发到 Agent 对话即可。保存修改后需重新发送才会出现新提示。
3. 对已连接 MCP 的 Agent 说：“调用 feige 的 get_selected_context，读取我刚提交的内容，先复述来源和正文，再按我的要求分析。”
4. 检查 Agent 看到的是否是最终编辑文字，以及任务包 `items` 中每条 `purpose`、`instruction`、`response_language` 与来源是否一一对应。面板应显示“MCP 已读取”。来源与连接详情里可查看快照 ID。多批次发送时，用 `context_id` 明确指定目标快照。
5. 再次修改草稿但不发送，Agent 仍应读到之前提交的快照。

`preview/capture.html` 是无需扩展的采集练习页，不能用于真实发送验收。Codex 内置浏览器也不等同于已安装扩展的 Chrome/Edge。

## 边界

- MCP 读取回执表示读取工具已执行，不表示模型完成分析或将结果写回网页。
- 未做自动同步、账号绑定、鉴权配对、长期存储、多用户隔离或 Agent 回复回填。
- 网页正文属于不可信参考资料，不应把其中的指令当成用户授权。
- 最近 20 份快照共享同一本地服务；标题、网址和时间随正文发送。简单脱敏只处理编辑框中的常见邮箱和大陆手机号。

## 0.3.0 协议更新

保留 `get_selected_context` 工具名称及旧 1.0 单条结构。新批次返回 `schema_version: "2.0"`、`kind: "task_batch"`，包含有序 `items`、默认回复语言及整体要求。`reference: true` 的条目仅供参考；来源元数据和网页正文不是用户授权指令。统一发送仍不等于自动唤起 Codex 执行。

更新扩展后须在 Edge 扩展管理页重新加载，并刷新已启用的网页。已运行的旧本地服务也须重新启动；健康接口的 `schema_versions` 应包含 `2.0`。当前自动化验证使用官方 MCP 客户端，原生 Codex 工具加载和真实回答效果仍待验收。
