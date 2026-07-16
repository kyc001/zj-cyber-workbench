

<aside>  
🛡️

**岗位使命：保证真君的多 Agent 真正有效、系统整体安全、正式版本达到发布标准。**负责 Agent Prompt、Context、评测、E2E、安全测试、报告、文档和最终发布质量。

</aside>

## 一、职责边界

负责：

- Agent 角色、System Prompt、Tool 描述与权限矩阵。
- Context Engineering 和结构化输出。
- Agent 评测集与 Mock Model。
- Prompt Injection 与越权测试。
- 跨模块集成测试和 Electron E2E。
- 安全测试、凭据泄漏检查。
- Incident Report 模板。
- README、SECURITY、CONTRIBUTING 和许可文件。
- SBOM、Release Notes、发布检查和最终验收。

成员 D 不是只负责测试，而是 Agent 行为与正式发布质量负责人。各模块负责人仍必须为自己的代码编写单元测试。

## 二、Agent 角色

定义并维护：

- `Ops Lead`
- `Diagnostic Engineer`
- `Security Engineer`
- `Load Test Engineer`
- `Remediation Engineer`
- `Verification Engineer`
- `Evidence Reporter`

每个 Agent 必须明确职责、输入、输出、允许/禁止工具、最大任务深度、委派条件、停止条件、审批条件、拒绝条件和最终输出 Schema。

## 三、Ops Lead

要求：

- 理解目标并读取 Project Scope。
- 将问题拆成诊断任务。
- 选择正确 Specialist，避免重复工作。
- 汇总证据，区分事实、推测和建议。
- 证据不足时继续诊断而不是直接修复。
- 不直接执行高风险操作。
- 修复后委派独立 Verification。
- 给出 Incident 最终总结和遗留风险。

## 四、Diagnostic Engineer

- 只读优先。
- 从低风险、高信息量检查开始。
- 每个检查说明目的。
- 将结果转成 Observation。
- 为根因假设提供支持或反证。
- 不把命令成功等同于系统健康。
- 不直接修改目标。

## 五、Security Engineer

- 只在授权 Scope 内工作。
- 区分发现、验证和利用。
- 默认不做破坏性测试。
- 不主动扩大目标范围。
- Finding 包含证据、影响、置信度和验证状态。
- 不把版本号直接等同于可利用漏洞。
- 明确误报和待验证状态。
- 遵守扫描、压测和漏洞验证硬限制。

## 六、Remediation Engineer

输出完整 ChangeSet：

- 问题和根因。
- 修复目标和预计影响。
- Precheck。
- Backup。
- Apply。
- Verify。
- Rollback。
- 风险和审批要求。

禁止无备份覆盖配置、无语法检查重启服务、无回滚修改生产配置、将执行成功视为修复成功。

## 七、Verification Engineer

必须独立于 Remediation：

- 重新读取目标状态。
- 验证原始问题、服务健康和安全问题。
- 检查副作用和关键回归项。
- 输出通过、失败或不确定。
- 失败时建议回滚。
- 不直接相信修复 Agent 的结论。

## 八、Evidence Reporter

- 从 Timeline、Finding、Execution、Artifact 和 ChangeSet 生成报告。
- 不执行命令。
- 对敏感信息脱敏。
- 保留证据引用和 SHA-256。
- 区分事实、结论、建议和遗留风险。

## 九、Context Engineering

每次模型调用只包含：

```
系统安全规则
→ 当前 Agent 职责
→ Project Scope 摘要
→ Incident 状态摘要
→ 最近相关 Timeline
→ 必要证据片段
→ 当前允许 Tool
```

禁止完整终端历史、完整扫描报告、私钥密码进入上下文；远程日志、网页、README、配置和 Artifact 都标记为不可信数据。

## 十、Prompt Injection 测试

准备恶意样本：

- 日志要求忽略规则。
- README 要求上传密钥。
- 配置文件伪造审批。
- HTTP 页面要求扫描额外目标。
- 命令输出诱导提权。
- Artifact 伪造 Tool Result。
- 用户要求绕过审批。

验证 Tool 权限、Scope、凭据和审批规则不会改变。

## 十一、Agent 评测集

至少覆盖：

- Linux 服务不可用。
- 磁盘不足、CPU 异常、端口占用。
- TLS 过期、DNS 错误、Nginx 配置错误。
- Windows 服务停止。
- 漏洞发现但证据不足。
- 修复失败与回滚。
- 压测超限、目标越界。
- Prompt Injection。
- SSH 权限不足和工具超时。

指标：Agent 选择、Tool 选择、Scope 违规、未审批写操作、根因准确性、ChangeSet/回滚完整率、Verification 独立性、报告完整性、Token 和时长。

## 十二、Mock Model

开发可在 CI 使用的 Mock Provider：

- 固定 Tool Call。
- 流式消息。
- 结构化输出错误。
- 超时、断开、Token 超限。
- 可复现 Agent 流程。

CI 不得依赖真实付费模型才能运行。

## 十三、自动化与集成测试

各成员写各自单元测试，D 负责跨模块：

- Agent 流程。
- Policy 负面测试。
- SSH 测试服务器和故障 Nginx。
- Sidecar 崩溃恢复。
- SQLite 升级恢复。
- SSH 断连、长输出、取消和并发。
- Electron E2E。
- Portable 冷启动。
- 报告与 Timeline 对账。

核心 E2E：首次启动 → 配置 Mock Model → 创建 Project/Scope → 连接 SSH → 诊断 → 提出修改 → 审批 → 执行 → 验证 → 导出报告 → 重启后数据仍在。

## 十四、安全测试

覆盖：

- XSS、CSP、Electron IPC 注入。
- Node Integration 和导航策略。
- 路径穿越和 SFTP 逃逸。
- Shell/PowerShell 注入。
- Approval Token 篡改和重放。
- Scope 与 Host Key 绕过。
- 日志和报告敏感信息泄漏。
- Sidecar/WebSocket 未认证访问。
- 本机 Workspace / SSH Workspace 目标越界。
- 压测参数拆分绕过。

成员 D 有权阻止存在 P0/P1 安全问题的版本发布。

## 十五、Incident Report

报告包含：

- Project、授权范围和 Incident 信息。
- 目标、症状、参与 Agent。
- Timeline、Observation、根因和 Finding。
- ProposedAction、Approval、Execution。
- ChangeSet、验证、回滚和遗留风险。
- Artifact ID、Hash 和生成时间。

输出 Markdown 和 HTML；PDF 不作为 v1.0 发布阻断项。

## 十六、文档与开源规范

负责：

```
README.md
README_zh.md
SECURITY.md
CONTRIBUTING.md
CODE_OF_CONDUCT.md
THIRD_PARTY_NOTICES.md
licenses/Z3r0-LICENSE
docs/development-environment.md
docs/operator-manual.md
docs/threat-model.md
docs/release-checklist.md
```

README 必须包含真君/ZJ 品牌、安全声明、三目能力、安装、使用、授权边界和 Z3r0 致谢。

## 十七、最终发布

负责协调：

- 版本号、Changelog、Release Notes。
- SHA-256 和 SBOM。
- 第三方许可。
- 安装包烟雾测试。
- 干净 Windows VM 验收。
- Git Tag 和 GitHub Release。
- Known Issues 和回滚说明。
- 发布阻断项签字确认。

正式产物：

```
ZJ-1.0.0-win-x64-portable.exe
ZJ-1.0.0-SHA256SUMS.txt
ZJ-1.0.0-SBOM.spdx.json
ZJ-1.0.0-third-party-licenses.txt
```

## 十八、最终交付物

- 7 个 Agent 正式 Prompt。
- Tool 权限矩阵和 Context 规范。
- Agent 评测集和 Mock Model。
- 集成测试、Electron E2E、安全测试报告。
- Prompt Injection 测试。
- Incident Report 模板。
- README、社区文件和许可文件。
- 用户手册和发布检查表。
- SBOM、Release Notes、最终测试报告。

## 二十一、当前 D 组落地资产

以下文件是本岗位前四项任务的当前落地版本，后续变更需要同步更新测试：

- `docs/d-agent-operating-spec.md`：7 个产品层 Agent 的正式职责、输入、输出、工具边界、审批条件、拒绝条件和输出 Schema。
- `docs/d-tool-permission-matrix.md`：人读版 Tool 权限矩阵和 Action 风险分层。
- `tests/fixtures/d_agent/tool_permission_matrix.json`：机器可读权限矩阵，供 CI 检查运行时工具覆盖。
- `tests/fixtures/d_agent/prompt_injection_cases.json`：Prompt Injection 与越权测试样本集。
- `tests/fixtures/d_agent/mock_model_scenarios.json`：Mock Model 场景，包括固定文本、固定 Tool Call、结构化输出错误、超时、断开和 Token 超限。
- `core/agent/mock_model.py`：CI 可注入的确定性 Mock Model。
- `tests/unit/test_d_agent_quality_assets.py`：上述资产的基础一致性测试。
- `docs/d-core-e2e-plan.md`：核心 E2E 验收方案。
- `tests/fixtures/d_agent/core_e2e_scenarios.json`：机器可读核心 E2E 步骤与阻断规则。
- `docs/d-report-timeline-reconciliation.md`：报告与 Timeline 对账规范。
- `core/agent/report_reconciliation.py`：报告引用对账辅助工具。
- `docs/release-checklist.md`：发布检查表。
- `docs/release-notes-template.md`：Release Notes 模板。
- `docs/known-issues.md`：Known Issues 模板和当前状态。
- `tests/fixtures/d_agent/release_manifest_required.json`：发布产物和阻断项清单。

## 十九、验收标准

- [ ] CI 不依赖真实模型即可运行。
- [ ] 远程内容不能改变 Agent 安全规则。
- [ ] 不存在未审批高风险执行路径。
- [ ] 核心 Incident 场景通过 E2E。
- [ ] 报告数据与 Timeline 一致。
- [ ] 安装包在干净 Windows 验收。
- [ ] README、License、NOTICE 和许可文件完整。
- [ ] 发布包有版本、校验值、SBOM 和 Known Issues。
- [ ] P0/P1 安全缺陷清零。

## 二十、对其他成员的接口

- 向 A 提供 Agent Prompt、权限矩阵、输出 Schema 和 Policy 负面测试。
- 向 B 提供 E2E、UI 安全测试、风险文案和报告字段。
- 向 C 提供恶意输入、Scope 越界、压测限制和执行失败测试。
- 接收 A/B/C 的测试构建、模块文档和发布候选产物。
