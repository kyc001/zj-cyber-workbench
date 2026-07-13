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

`install` 执行 `uv sync` 和 `pnpm install`。开发时将 `.env.example` 复制为仓库根目录 `.env` 并填写真实 API Key；Portable 模式使用 `data/.env`。两者都不提交 Git。首次启动后端时会从 `.z3r0/config.json.example` 创建 `.zj/config.json`，并生成新的加密密钥。

## 运行

分别启动后端和前端：

```powershell
./scripts/dev.ps1 backend
./scripts/dev.ps1 web
```

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

该命令依次构建 React Renderer、`dist/zj-core.exe`、Electron Main/Preload，并在 `desktop/release/ZJ-<version>-win-x64-portable.exe` 生成单文件便携包。`scripts/package-portable.ps1` 会检查每一步的退出码，任何子构建失败都会使整个命令失败。

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
