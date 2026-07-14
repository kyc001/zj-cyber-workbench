<div align="center">

# 真君 · ZJ

### Multi-Agent Cyber Operations Workbench

**开天眼，见真因。**

Authorized security testing · Infrastructure diagnostics  
Remote remediation · Evidence-driven operations

</div>

> [!WARNING]
> ZJ is intended exclusively for authorized security testing,
> infrastructure operations, defensive research, CTF education, and
> controlled laboratory environments. Do not use ZJ to access, scan, test,
> disrupt, or modify systems without explicit authorization.

> [!WARNING]
> 真君仅用于经过明确授权的网络安全测试、基础设施运维、防御性安全研究、
> CTF 教学及受控实验环境。禁止在未获得授权的情况下扫描、访问、测试、
> 干扰或修改任何系统。

真君（ZJ）是一款面向 Windows 的多智能体网络安全运维工作台。项目在 Z3r0
的 FastAPI、React、多 Agent Runtime、证据模型和 Timeline
基础上，增加 Incident、授权范围、风险策略、人工审批、远程运维、变更回滚和
独立验证能力，并通过 Electron 交付桌面产品。

## Upstream & Attribution · 上游与署名

ZJ is an independent derivative project based on
[Z3r0](https://github.com/yv1ing/Z3r0), originally created by
[yv1ing](https://github.com/yv1ing).

真君（ZJ）是基于 [Z3r0](https://github.com/yv1ing/Z3r0) 二次开发的独立衍生项目。
Z3r0 原作者为 [yv1ing](https://github.com/yv1ing)，原项目版权声明为
`Copyright (c) 2026 yv1ing`，并采用 MIT License 发布。

- Upstream project / 上游项目：[github.com/yv1ing/Z3r0](https://github.com/yv1ing/Z3r0)
- Original author / 原作者：[github.com/yv1ing](https://github.com/yv1ing)
- Original license / 原始许可证：[licenses/Z3r0-LICENSE](licenses/Z3r0-LICENSE)
- Third-party notices / 第三方声明：[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

ZJ is not an official Z3r0 release and is not endorsed by the original author.
ZJ 不是 Z3r0 官方版本，也不代表原作者对本项目提供背书。

当前仓库已经迁入 Z3r0 的 Control、Runtime、Evidence 与 Sandbox 用户能力，并将
Docker Sandbox 替换为 Windows 本机与 SSH Linux 双后端执行工作区。HTTP/Web 检查、端口探测、SSH、
同步/异步命令、文件管理、项目绑定、审批和审计已接通；生产写操作和高风险工具仍
必须经过 Scope 与审批，不得把当前版本用于未授权目标。

## CVE Discovery

项目工作台内置结构化 CVE 发现链路：

- 服务与中间件：按 CPE 2.3 或厂商/产品查询 NVD，并对目标版本执行精确版本、区间版本和弱候选分级。
- 软件依赖：按生态、包名和精确版本查询 OSV，保留受影响范围与已知修复版本。
- 风险优先级：聚合 CVSS、EPSS 与 CISA KEV，已知在野利用候选优先展示。
- 证据闭环：候选可绑定 WorkProject 资产并去重写入 Finding，保存 CWE、引用、版本、证据和修复建议。
- 误报控制：被动情报只能进入 `suspected`；必须完成独立主动验证后才能标记 `validated`。

相较仓库内固定基线 `Z3r0@79776a2`，ZJ 新增了专用 CVE 数据契约、情报 API、版本适用性判定、
KEV/EPSS 丰富、SQLite 升级、Agent 查询工具和可操作工作台。因而在 CVE 发现与分级这一条能力线上，
ZJ 明显更强；这不等于所有安全工具覆盖都全面超过 Z3r0，主动模板扫描和 Linux 专属验证仍由 C 组继续集成。

## Architecture

```text
Electron Main / Preload / React Renderer
                 |
       loopback REST + WebSocket
                 |
      ZJ Core (FastAPI + Agent Runtime)
        |          |           |
    Evidence    Policy      Execution
        |          |           |
    Timeline    Approval   SSH / Windows / Portable Tools
```

## Workspace

- `core/`, `service/`, `model/`, `schema/`, `router/`, `handler/`: migrated and adapted Z3r0 control plane.
- `web/`: 已迁移并汉化的 React 工作台，覆盖 Agent、项目、知识、主机、出口和执行工作区。
- `desktop/`: Electron Main/Preload、Sidecar 生命周期和 Portable 发布配置。
- `skills/`: 完整迁入的上游 Skill 契约；运行时按 Windows 本机或 SSH Linux 后端解析。
- `tests/`: shared contract and policy tests; every owner adds module tests here.
- `docs/role-a-lead.md`: A/组长的职责、关键路径与实施顺序。
- `docs/upstream-migration.md`: 上游逐文件扫描方法、迁移结论和风险。
- `docs/team-handoff.md`: A/B/C/D 接口冻结与交接规则。
- `docs/no-docker-portable-architecture.md`: 无 Docker 与 Portable EXE 的覆盖性架构决策。
- `docs/development-environment.md`: Windows 开发、验证和本地文件规则。
- `docs/migration-validation.md`: 完整迁移范围、真实 Agent 工具案例和验证结果。
- `docs/tool-capability-matrix.md`: 25 个 Skill 的 Windows/SSH 实际执行路径。
- `docs/a-handoff-2026-07-14.md`: A 组当前交付、CVE 契约、验证结果与 B/C/D 接手清单。

## Portable Desktop

- 构建产物为 `desktop/release/ZJ-<version>-win-x64-portable.exe`；桌面主进程名为
  `zhenjun.exe`，Python Sidecar 进程名为 `zj-core.exe`。
- 浏览器开发模式和 Portable 模式都直接进入 `/playground`，不显示登录页，也不要求用户设置或输入密码。
  Sidecar 只监听回环地址，并将本机请求直接映射为内置管理员身份；前端不申请、不保存也不传递登录 Token。
- 首次启动时 Provider Base URL 和 Key 均为空，不预设或推荐任何服务商。在 **System Config** 中可分别配置每个 Agent 的
  Base URL、API Key 和 Model，也可通过顶部统一配置一键应用到全部 Agent。
- Model 控件可调用 OpenAI-compatible `<baseURL>/models` 拉取列表、搜索、下拉选择，
  也允许手工输入服务端未列出的模型名。
- 顶栏权限模式提供“普通访问”和“完全访问”。普通访问在越出声明范围或执行中高风险操作时弹出
  “拒绝 / 本次允许 / 始终允许”；完全访问不检查目标范围、不弹窗，也不写权限与执行守卫审计。
- 用户填写的 Key 只保存到便携 EXE 同目录的 `data/config.json`。构建不会把仓库根目录
  `.env`、本地数据库或已有 `data/` 打进 EXE；这些文件也不会提交到 Git。

## Development

Required baseline: Windows 10/11 x64, Node.js 22.12+, pnpm 10, Python 3.12,
and uv. Docker is intentionally not used by this project.

```powershell
./scripts/dev.ps1 doctor
./scripts/dev.ps1 install
./scripts/dev.ps1 test
```

Development services are deliberately separate:

```powershell
./scripts/dev.ps1 backend
./scripts/dev.ps1 web
./scripts/dev.ps1 desktop
```

日常修改前端时使用快速模式：

```powershell
./scripts/dev.ps1 ui
```

它运行源码后端和 Vite 浏览器界面，不执行 PyInstaller/Electron 打包；浏览器打开
`http://127.0.0.1:5173/playground` 即可交互。Portable EXE 只在发布验收时构建。

安装便携扫描器（下载到忽略的 `.zj/tools`，不进入 Git；发布构建只将该工具子目录打入 EXE）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-portable-tools.ps1 -Proxy http://127.0.0.1:7897
powershell -ExecutionPolicy Bypass -File scripts/validate-portable-tools.ps1
```

The backend uses embedded SQLite and local LightRAG storage. Put provider secrets
in an ignored `.env` based on `.env.example`. First start creates `.zj/config.json`;
never commit `.env`, `.zj/`, databases, logs, or artifacts. The original `/Z3r0/`
checkout is fully ignored.

逐文件复核上游迁移和 Skill 结构：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/audit-upstream-migration.ps1
powershell -ExecutionPolicy Bypass -File scripts/validate-portable-skills.ps1
./scripts/dev.ps1 e2e
```

`e2e` 会执行 Python 回归、OpenAPI/TypeScript 生成、Web/Desktop 构建、静态检查、
432 文件与 API 对账、Skill 校验及 Git 空白检查；不会重复打包 EXE。已安装便携工具的
机器可额外运行 `scripts/validate-migration.ps1 -IncludePortableTools` 验证真实命令运行时。

Build the single-file Windows package with `pnpm package:portable`. End users should
configure providers in the desktop UI; the repository `.env` is only a local
development override and is never a release input.

## Team Ownership

| Owner | Boundary |
| --- | --- |
| A | Runtime, Incident, Scope, Policy, Approval, state, persistence, API, Timeline |
| B | Electron, React workspace, sidecar UX, terminal UI, packaging |
| C | Transport, SSH/SFTP, PowerShell, portable process execution, Toolpack |
| D | Agent prompts, context, evaluations, cross-module tests, reports, release quality |

## Acknowledgments

ZJ is based in part on the architecture and source code of
[Z3r0](https://github.com/yv1ing/Z3r0), originally created by
[yv1ing](https://github.com/yv1ing), and
distributed under the MIT License. ZJ is an independent derivative project;
no upstream endorsement is implied.
