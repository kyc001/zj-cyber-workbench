# 真君（ZJ）

真君是面向 Windows 的多智能体网络安全运维工作台，用于经过明确授权的安全测试、基础设施诊断、远程运维、修复审批、独立复测与证据留存。项目基于 Z3r0 的 FastAPI、React 和 Agent Runtime 演进，使用 SQLite、本机工作区和 SSH Linux 工作区，不依赖 Docker。

> 真君只能用于你拥有或已获得明确授权的系统。禁止扫描、访问、干扰或修改任何未授权目标。

## 核心能力

- 多 Agent 协作：任务拆解、诊断、安全验证、修复建议、独立复测和报告生成。
- 受控执行：Project Scope、风险分级、运行时授权和 Timeline 审计。
- 双工作区：Windows 本机命令与 SSH Linux 命令、文件和终端操作。
- 证据闭环：会话、工具调用、结果、报告引用和 SQLite 持久化。

## 本地开发

要求 Windows 10/11 x64、Python 3.12、uv、Node.js 22.12+、pnpm 10 和 Git。

```powershell
./scripts/dev.ps1 doctor
./scripts/dev.ps1 install
./scripts/dev.ps1 ui
```

浏览器访问 `http://127.0.0.1:5173/playground`。Provider 配置保存在本机 `.env` 或忽略的 `.zj/config.json` 中，禁止提交 API Key、SSH 凭据、数据库、日志和 Artifact。

## 测试

```powershell
./scripts/dev.ps1 test
pnpm test:d-runtime
pnpm test:d-web
```

`pnpm test:d-web` 使用临时数据目录、独立端口和 Mock Model，不调用真实模型，也不会修改日常 `.zj` 数据。

## 文档

- [开发环境](docs/development-environment.md)
- [操作手册](docs/operator-manual.md)
- [安全政策](SECURITY.md)
- [威胁模型](docs/threat-model.md)
- [贡献指南](CONTRIBUTING.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)

## 致谢与许可

ZJ 是基于 [Z3r0](https://github.com/yv1ing/Z3r0) 的独立衍生项目。原项目许可副本位于 `licenses/Z3r0-LICENSE`，第三方说明见 `THIRD_PARTY_NOTICES.md`。
