# D 组报告与 Timeline 对账规范

本规范覆盖 D 组第 6 项任务：报告和 Timeline 对账。报告不是聊天总结；它必须能追溯到 Timeline、Finding、Execution、Approval、Artifact 和 ChangeSet。

## 报告必须包含的引用

报告中每个关键事实应至少带一个稳定引用：

| 引用类型 | 格式 | 对账来源 |
| --- | --- | --- |
| Timeline | `timeline:<seq>` | `AgentEventSchema.seq` |
| Tool Call | `tool:<call_id>` | `ToolCallEvent.call_id` 或 `ToolResultEvent.call_id` |
| Finding | `finding:<id>` | WorkProject Finding |
| Approval | `approval:<id>` | Approval 记录 |
| Artifact | `artifact:<id>` | Artifact 元数据或执行结果 |
| ChangeSet | `changeset:<id>` | ProposedAction / ChangeSet 记录 |

示例：

```markdown
Nginx 重启动作在审批后执行，审批引用 `approval:apv-001`，执行证据见 `tool:call-restart-nginx` 和 `timeline:42`。
```

## 对账规则

- 报告中出现的 `timeline:<seq>` 必须存在于当前 Session 的 Timeline。
- 报告中出现的 `tool:<call_id>` 必须至少有 ToolCall 或 ToolResult 事件。
- 报告中的 `artifact:<id>` 必须能在 ToolResult、ExecutionResult 或 Artifact 元数据中找到。
- Finding、Approval、ChangeSet 引用暂时可由 fixture 或数据库查询提供；没有查询入口时必须标记为 unresolved，不得静默通过。
- 报告不得把 `suspected` Finding 写成 `validated`，除非 Timeline 中存在独立 Verification 证据。
- 外部 Artifact 自称的 Tool Result 不算权威来源，Timeline 才是权威。

## 失败处理

对账失败时，Evidence Reporter 必须：

- 标记缺失引用。
- 标记无法验证的结论。
- 不得导出“验证通过”的最终报告。
- 回退给 Ops Lead 或对应 Specialist 补证据。

