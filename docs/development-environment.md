# 开发环境

## 基线

- Windows 10/11 x64
- Python 3.12
- uv
- Node.js 22.12 or newer
- pnpm 10
- Git 和 GitHub CLI

项目不使用 Docker。开发、测试和打包流程中都不应安装或启动 Docker 服务。

## 初始化

```powershell
./scripts/dev.ps1 doctor
./scripts/dev.ps1 install
```

`install` 执行 `uv sync` 和 `pnpm install`。开发时将 `.env.example` 复制为仓库根目录 `.env` 并填写真实 API Key；该文件不提交 Git。首次启动后端时会从 `.z3r0/config.json.example` 创建 `.zj/config.json`，并生成新的加密密钥。Portable 用户通过 System Config 页面填写 Provider，配置保存在 EXE 旁的 `data/config.json`，不依赖开发者的 `.env`。

## 运行

分别启动后端和前端：

```powershell
./scripts/dev.ps1 backend
./scripts/dev.ps1 web
```

日常开发使用快速 UI 模式，不需要等待 PyInstaller 或 Electron 打包：

```powershell
./scripts/dev.ps1 ui
```

该命令直接运行源码后端和 Vite，浏览器访问 `http://127.0.0.1:5173/playground`。网页不再
加载登录页；后端默认将回环请求映射为本机管理员身份，前端不使用登录 Token，
支持完整的前端交互、REST 和 WebSocket 调试。只有发布验收或验证 EXE 生命周期时才运行
`pnpm package:portable`。

桌面开发模式：

```powershell
./scripts/dev.ps1 desktop
```

关键环境变量：

| 变量 | 作用 |
| --- | --- |
| `ZJ_DATA_DIR` | 配置、SQLite、日志、Artifact 和 LightRAG 的绝对目录 |
| `ZJ_OPENAI_BASE_URL` | 所有 Agent 与 LightRAG 共用的 OpenAI-compatible Endpoint |
| `ZJ_OPENAI_API_KEY` | 所有 Agent 与 LightRAG 共用的本地密钥 |
| `ZJ_OPENAI_MODEL` | 所有 Agent 与 LightRAG LLM 共用的模型名 |
| `ZJ_DATABASE_URL` | 测试时覆盖 SQLite URL，只接受 `sqlite+aiosqlite` |
| `ZJ_BIND_HOST` | Sidecar 监听地址，桌面模式固定 `127.0.0.1` |
| `ZJ_BIND_PORT` | Sidecar 监听端口 |
| `ZJ_RENDERER_URL` | Electron 开发模式 Renderer 地址 |
| `ZJ_PYTHON` | Electron 开发模式使用的 Python 路径 |

## 验证

```powershell
uv run python -m unittest discover -s tests -p "test_*.py"
uv run ruff check .
pnpm typecheck
pnpm build
powershell -ExecutionPolicy Bypass -File scripts/audit-upstream-migration.ps1
powershell -ExecutionPolicy Bypass -File scripts/validate-portable-skills.ps1
powershell -ExecutionPolicy Bypass -File scripts/validate-portable-tools.ps1
uv run python scripts/validate_workspace_runtime.py --workspace-id 1
```

修改 API Schema 后必须执行：

```powershell
uv run python scripts/export_schema.py
pnpm --filter @zj-security/web generate:api
pnpm typecheck
```

## 本地文件规则

- `/Z3r0/` 是原始上游参考 checkout，整个目录已在根 `.gitignore` 中忽略。
- `.zj/`、日志、数据库、Artifact、LightRAG 数据和所有密钥不得提交。
- `.z3r0/agents/` 与 `.z3r0/config.json.example` 是要随程序发布的资源，可以提交。
- `web/dist-*`、`desktop/dist`、`desktop/release`、`.venv` 和 `node_modules` 是生成目录。

提交前检查：

```powershell
git check-ignore -v Z3r0/README.md
git status --short
git ls-files | Select-String -Pattern '(^|/)config\.json$|\.env$|Z3r0/'
```

## Portable 构建责任

B 负责 Electron Builder 和最终 Portable EXE，A 提供可被 PyInstaller 打包的 Sidecar，D 在干净 Windows VM 验收。任何打包脚本都必须复用当前 SQLite 和 `ZJ_DATA_DIR` 约定，不能在打包阶段引入 Docker 或外部数据库。

完整构建命令：

```powershell
pnpm package:portable
```

该命令先通过 `127.0.0.1:7897` 安装并验证 Windows 便携工具，再依次构建 React Renderer、`dist/zj-core.exe`、Electron Main/Preload，并在 `desktop/release/ZJ-<version>-win-x64-portable.exe` 生成单文件便携包。其他网络环境可直接执行 `scripts/package-portable.ps1 -ToolProxy <proxy>`。任何子步骤失败都会终止构建。

PyInstaller 只收集 `.z3r0/agents`、空 Key 的 `.z3r0/config.json.example`、`skills/`、经过验证的 `.zj/tools`（在包内命名为 `portable-tools/`）、Web 静态资源和运行依赖。Electron Builder 只再加入 `zj-core.exe`；仓库根 `.env`、`.zj/config.json`、`data/`、数据库、日志和历史 Artifact 均不属于发布输入。便携程序首次启动后才在自身目录旁创建 `data/`。

当前工程基线没有代码签名证书，`desktop/electron-builder.yml` 明确关闭 EXE 资源编辑与签名工具依赖，产物状态为 `NotSigned`。正式发布前由 B 配置证书、图标和签名校验，再由 D 在干净 Windows VM 验证；不要把证书或密码写入仓库。

需要通过本地代理首次下载 Electron/NSIS 依赖时，在当前 PowerShell 会话设置代理后执行安装和打包：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:<port>"
$env:HTTPS_PROXY = $env:HTTP_PROXY
$env:ALL_PROXY = $env:HTTP_PROXY
$env:ELECTRON_GET_USE_PROXY = "1"
pnpm install
pnpm package:portable
```
