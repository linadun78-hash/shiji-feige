# 开发与验证

本仓库包含独立运行的扩展与本地服务。所有命令在仓库根目录执行。

## 构建扩展

Node 24 用于当前构建及 Node 测试。发布源码内已附带构建产物，运行扩展不需要 Node。

```powershell
npm ci --ignore-scripts
npm run build
npm test
```

构建将面板模板、CSS 和本地第三方库整合到 `extension/`。不从 CDN 加载运行代码。修改后在扩展管理页重新加载，再刷新原网页。

## 服务测试

```powershell
python -m pip install -r server/requirements.txt
python -m pip install pytest
python -m pytest -c pytest.ini tests -q
```

真实 MCP 协议测试使用隔离的临时本地端口，不依赖用户正在运行的 8766 服务。

## 浏览器测试

测试使用 Playwright 和可加载未打包扩展的 Chromium。可安装 Playwright 作为本地测试依赖：

```powershell
npm install --no-save --package-lock=false playwright
npx playwright install chromium
$env:FEIGE_TEST_PORT = '18766'
node tests/browser-capture.cjs
node tests/browser-send.cjs
node tests/browser-isolation.cjs
```

也可以通过 `PLAYWRIGHT_MODULE`、`CHROMIUM_PATH` 和 `PYTHON_PATH` 指定已有测试运行时。现有验证使用 Chromium 131，新的 Chromium/Playwright 组合需要实际复测，不能由安装命令推断兼容。

`browser-send.cjs` 检查端口是否已占用，拒绝复用现有用户服务；不要修改这个检查。浏览器测试只在临时配置中运行，并使用合成网页资料。

定位器测试会在临时扩展副本中开放 Shadow Root；`browser-isolation.cjs` 另加载未经修改的正式扩展，检查其封闭根和普通 DOM 隔离。开放的临时副本不能作为正式发行包。

截图输出到 `evaluations/`，测试浏览器资料输出到系统临时目录；二者均不作为用户数据或公开仓库内容提交。

## 已有证据与未完成项

0.3.0 在 Windows、Node 24.12、Python 3.12.7、Chromium 131 上已有 Node 11 项、Python 14 项及浏览器流程验证记录。当前发布副本的实际验证结果见 [SOURCE_PREVIEW_VERIFICATION.md](SOURCE_PREVIEW_VERIFICATION.md)。

上述自动化不等于原生 Codex 已发现工具，也不等于 Windows 免环境安装包、服务授权和持久化已实现。不声明节省时间比例或全站兼容率。
