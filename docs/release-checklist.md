# ZJ Release Checklist

本清单由 D 组维护，用于正式发布前验收。

## 1. 版本与范围

- [ ] 版本号已确定。
- [ ] Changelog 已更新。
- [ ] Release Notes 已更新。
- [ ] Known Issues 已更新。
- [ ] 发布范围和非目标已确认。

## 2. 自动化验证

- [ ] `./scripts/dev.ps1 doctor` 通过。
- [ ] `./scripts/dev.ps1 test` 通过。
- [ ] `pnpm build` 通过。
- [ ] `powershell -ExecutionPolicy Bypass -File scripts/audit-upstream-migration.ps1` 通过。
- [ ] `powershell -ExecutionPolicy Bypass -File scripts/validate-portable-skills.ps1` 通过。
- [ ] `powershell -ExecutionPolicy Bypass -File scripts/validate-portable-tools.ps1` 通过，或明确记录工具未安装原因。

## 3. D 组质量门

- [ ] CI 不依赖真实模型即可运行 Mock Model 测试。
- [ ] Prompt Injection 样本全部通过。
- [ ] 未审批高风险执行路径为零。
- [ ] 核心 E2E 通过。
- [ ] 报告与 Timeline 对账通过。
- [ ] P0/P1 安全问题清零。

## 4. 安全与隐私

- [ ] `.env` 未进入发布包。
- [ ] `.zj/` 数据未进入发布包。
- [ ] SQLite、日志、历史 Artifact 未进入发布包。
- [ ] 模型 Key 不在 Renderer、localStorage、日志或报告中。
- [ ] SSH 密码、私钥、Host Key 绕过风险已检查。
- [ ] Electron Renderer 无 Node 权限。
- [ ] CSP 和导航策略已检查。

## 5. 发布产物

- [ ] `ZJ-<version>-win-x64-portable.exe`
- [ ] `ZJ-<version>-SHA256SUMS.txt`
- [ ] `ZJ-<version>-SBOM.spdx.json`
- [ ] `ZJ-<version>-third-party-licenses.txt`
- [ ] `README.md`
- [ ] `THIRD_PARTY_NOTICES.md`
- [ ] `licenses/Z3r0-LICENSE`

## 6. 干净 Windows VM 验收

- [ ] 首次启动成功。
- [ ] 可配置 Provider。
- [ ] 可创建 Project 和 Scope。
- [ ] 可打开 Playground。
- [ ] 可执行只读诊断。
- [ ] 可导出报告。
- [ ] 关闭重启后数据仍在。
- [ ] 无 Docker 依赖。

