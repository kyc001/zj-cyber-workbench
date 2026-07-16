# D 组核心 E2E 验收方案

本方案覆盖 D 第 5 项任务：核心 E2E。目标不是证明某个页面能打开，而是证明 Agent、Scope、审批、执行、验证、报告和持久化能形成闭环。

## 验收主链路

核心链路必须按顺序完成：

1. 冷启动应用，使用临时 `ZJ_DATA_DIR`。
2. 配置 Mock Model，不依赖真实付费模型。
3. 创建 Project，并声明 Scope。
4. 创建或选择执行 Workspace。
5. 由 Ops Lead 拆解任务。
6. Diagnostic Engineer 执行只读诊断。
7. Remediation Engineer 生成 ChangeSet。
8. Policy 对 ChangeSet 做风险判定。
9. 用户审批 L2 或更高风险操作。
10. 执行层按 Approval Token 执行。
11. Verification Engineer 独立复核。
12. Evidence Reporter 导出报告。
13. 重启后确认 Project、Timeline、Finding、Approval、Report 元数据仍可读取。

## 通过标准

- 每个阶段都产生 Timeline 事件。
- 每个执行动作都有 Action 类型、目标、风险、审批状态和结果。
- 未审批写操作不能进入执行层。
- 越界目标必须被 Policy 或 Runtime Permission 拒绝。
- Verification 不能只复用 Remediation 的结论，必须重新读取目标状态。
- 报告中的 Finding、Execution、Approval、Artifact 引用必须能在 Timeline 或数据库事实中对账。
- 重启后数据仍在，不依赖内存状态。

## 失败即阻断

- CI 必须连接真实模型才能跑通。
- Agent 读取外部内容后改变系统规则或工具权限。
- L2/L3 操作没有审批也执行。
- 报告引用不存在的 Timeline、Artifact、Finding 或 Approval。
- 重启后会话、Timeline 或报告元数据丢失。
- 凭据出现在日志、报告、Agent 上下文或 Artifact 摘要。

## 建议自动化层次

| 层级 | 目标 | 推荐实现 |
| --- | --- | --- |
| fixture contract | 固定 E2E 步骤和阻断规则 | `tests/fixtures/d_agent/core_e2e_scenarios.json` |
| unit | 检查 D 资产完整性 | `tests/unit/test_d_agent_quality_assets.py` |
| integration | 用 Mock Model 跑 Agent Runtime | 后续由 A 提供可注入入口后接入 |
| browser E2E | 点击 UI 跑核心路径 | 后续由 B 提供 Playwright/Electron harness |
| release smoke | 干净 Windows VM 跑 portable | 发布候选阶段执行 |

## Mock 场景设计

最小 Mock 场景应覆盖：

- Diagnostic 输出只读检查计划。
- Remediation 输出 ChangeSet，不直接执行。
- Policy 返回 `require_approval`。
- Approval Token 绑定 Action Hash。
- Execution 返回结构化结果。
- Verification 独立读取状态并输出 `pass`。
- Evidence Reporter 输出带引用的 Markdown。

## 人工验收脚本

在 UI 中执行时，D 组按以下清单记录证据：

```text
1. 打开 /playground。
2. 配置 Mock Provider 或测试模型。
3. 创建测试项目和 Scope。
4. 绑定本机或 SSH Workspace。
5. 输入授权诊断任务。
6. 确认 Agent 先诊断而不是直接修改。
7. 对修复动作确认弹窗，检查目标、Action、风险和变更摘要。
8. 审批后执行。
9. 检查 Verification 是否重新读取目标状态。
10. 导出 Markdown 报告。
11. 重启后确认项目、Timeline 和报告仍可访问。
```

