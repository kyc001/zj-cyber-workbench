# 真君多智能体网络安全运维工作台

真君多智能体网络安全运维工作台是一个面向授权安全测试、CTF 教学和基础设施运维诊断的 Windows 桌面应用。项目由本组完成，采用前后端分离加桌面壳的结构：React 负责工作台界面，FastAPI 负责业务接口和 Agent Runtime，Electron 负责桌面端启动、窗口管理和 Python sidecar 生命周期。

## 核心功能

- 多 Agent 协作：内置安全协调、代码审计、情报侦察、安全测试、密码协议、逆向分析等角色。
- Playground 工作台：支持会话、流式消息、子 Agent 面板、报告下载、文件上传和执行工作区绑定。
- 执行工作区：支持本机 portable workspace 与 SSH managed host workspace。
- Toolpack 工具箱：提供结构化工具发现、参数校验、运行、取消、结果解析和 artifact 下载。
- 主机与运维管理：支持主机登记、SSH host key 信任、SFTP 文件操作、本机受控 PowerShell 动作。
- 知识库与项目管理：支持知识资源、文档处理、项目资产、发现项和图谱视图。
- Skill 自定义与 Skill Hub：支持本地安装 Skill 包，也提供独立 Skill Hub 服务用于发布、浏览和下载 Skill。
- 桌面打包：支持 Windows portable/installer 构建，后端以 PyInstaller sidecar 形式随 Electron 应用启动。

## 技术栈

- 后端：Python 3.12、FastAPI、SQLModel、SQLite、OpenAI Agents SDK、LightRAG。
- 前端：React 19、TypeScript、Vite、Semi UI、CodeMirror、xterm.js、Cytoscape、Mermaid。
- 桌面端：Electron、electron-builder、PyInstaller。
- 包管理与构建：uv、pnpm、PowerShell 脚本。
- Skill Hub：FastAPI、SQLAlchemy async、JWT、可选 Redis 限流、独立 React 前端。

## 目录结构

```text
core/             Agent Runtime、模型接入、工具注册、上下文和安全控制
service/          业务服务层，包括 Agent、Sandbox、Host、Toolpack、Skill Hub 等
router/handler/   FastAPI 路由与请求处理器
schema/model/     Pydantic/SQLModel 数据结构
web/              主工作台 React 前端
desktop/          Electron 桌面壳
skill_hub/        独立 Skill Hub 后端
skillhub-web/     独立 Skill Hub 前端
skills/           内置 Agent Skill
scripts/          开发、测试、打包和验证脚本
tests/            单元测试、集成测试和 E2E 测试
docs/             项目需求、设计、开发和总结文档
```

## 本地开发

环境要求：

- Windows 10/11 x64
- Python 3.12
- Node.js 22+
- pnpm 10
- uv
- Git

初始化：

```powershell
.\scripts\dev.ps1 doctor
.\scripts\dev.ps1 install
```

启动后端：

```powershell
.\scripts\dev.ps1 backend
```

启动主工作台前端：

```powershell
.\scripts\dev.ps1 web
```

快速 UI 联调：

```powershell
.\scripts\dev.ps1 ui
```

启动 Skill Hub：

```powershell
python skill_hub_main.py
pnpm dev:skill-hub
```

## 测试与打包

常规验证：

```powershell
uv run python -m unittest discover -s tests -p "test_*.py"
pnpm typecheck
pnpm build
```

Windows 打包：

```powershell
pnpm package:portable
```

如果需要携带便携安全工具，可使用构建脚本的 `-IncludePortableTools` 参数；首次下载工具时可通过 `-ToolProxy` 指定代理。

## 安全边界

本项目只面向授权场景。Agent、Toolpack、SSH、文件操作和本机动作均应受到项目范围、权限、审批和路径校验约束。桌面端 sidecar 只绑定本机 loopback 地址；运行数据默认写入本机用户数据目录或开发环境 `.zj/`，不应提交密钥、token、数据库、日志或 artifact。

详细说明见 `docs/` 下四份项目文档。
