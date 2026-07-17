# ZJ Threat Model

## Assets

- Provider API keys and model configuration.
- SSH passwords, private keys, known-host decisions, and remote files.
- Project Scope, Approval Tokens, Timeline, Findings, reports, and artifacts.
- Local/remote command capability and desktop-sidecar authority.

## Trust Boundaries

1. Electron Renderer to preload/main process.
2. Browser or Renderer to loopback FastAPI/WebSocket endpoints.
3. Agent Runtime to policy, approval, and execution services.
4. Local workspace to SSH remote workspace.
5. External pages, logs, repositories, command output, model output, and artifacts to trusted application state.

## Primary Threats and Controls

| Threat | Required control | Release evidence |
| --- | --- | --- |
| Prompt injection changes scope or policy | Treat external content as untrusted; enforce scope in code | Injection fixtures and negative tests |
| Unapproved write or privilege escalation | Risk classification, approval token bound to action hash | Approval and execution-guard tests |
| Out-of-scope scanning or load-test splitting | Immutable target/action limits and aggregate load limits | Policy tests and controlled E2E |
| Renderer XSS or IPC abuse | CSP, context isolation, no Node integration, narrow preload API | Electron security review/E2E |
| Path traversal or SFTP escape | Canonical workspace roots and path validation | Local/SSH file tests |
| Shell/PowerShell injection | Structured action arguments and transport-level escaping | Malicious argument tests |
| Credential leakage | Secret redaction and release exclusions | Git/release scan and report review |
| Approval replay or tampering | Signed token, expiry, action/target/project binding | Approval gate tests |
| Sidecar or WebSocket exposure | Mandatory loopback bind and local identity | startup and network tests |
| Crash creates false success | Durable states, cancellation, restart reconciliation | recovery E2E |

## Release Blockers

Any reproducible P0/P1 issue involving unauthorized execution, scope bypass, credential disclosure, remote sidecar exposure, approval bypass, or unrecoverable evidence loss blocks release. Residual P2/P3 risks require an owner, workaround, target fix, and entry in `docs/known-issues.md`.
