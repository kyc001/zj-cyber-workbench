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

当前仓库处于工程基线阶段：上游代码已迁移，桌面壳、运维领域契约、
SQLite 便携持久化以及 Electron + PyInstaller Portable EXE 打包链路已建立，
但业务 API、SSH Transport 和正式 Agent Prompt 仍需按团队分工实现。
不要把当前骨架误认为可对生产环境执行变更的正式版本。

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
- `web/`: migrated React workbench; B owns the desktop product experience and remaining rebrand.
- `desktop/`: Electron Main/Preload and sidecar lifecycle skeleton.
- `toolpacks/`: portable, manifest-driven operations and security tools (implemented by C).
- `tests/`: shared contract and policy tests; every owner adds module tests here.
- `docs/role-a-lead.md`: A/组长的职责、关键路径与实施顺序。
- `docs/upstream-migration.md`: 上游逐文件扫描方法、迁移结论和风险。
- `docs/team-handoff.md`: A/B/C/D 接口冻结与交接规则。
- `docs/no-docker-portable-architecture.md`: 无 Docker 与 Portable EXE 的覆盖性架构决策。
- `docs/development-environment.md`: Windows 开发、验证和本地文件规则。

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

The backend uses embedded SQLite and local LightRAG storage. Put provider secrets
in an ignored `.env` based on `.env.example`. First start creates `.zj/config.json`;
never commit `.env`, `.zj/`, databases, logs, or artifacts. The original `/Z3r0/`
checkout is fully ignored.

## Team Ownership

| Owner | Boundary |
| --- | --- |
| A | Runtime, Incident, Scope, Policy, Approval, state, persistence, API, Timeline |
| B | Electron, React workspace, sidecar UX, terminal UI, packaging |
| C | Transport, SSH/SFTP, PowerShell, portable process execution, Toolpack |
| D | Agent prompts, context, evaluations, cross-module tests, reports, release quality |

## Acknowledgments

ZJ is based in part on the architecture and source code of
[Z3r0](https://github.com/yv1ing/Z3r0), originally created by yv1ing and
distributed under the MIT License. ZJ is an independent derivative project;
no upstream endorsement is implied.
