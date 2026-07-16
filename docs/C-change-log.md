# C Module Change Log

This document records C module changes made during implementation and verification follow-up. Each entry lists what changed, why it changed, and the expected effect.

## 2026-07-15

### feat: add toolpack frontend entry (`4efddb4`)

- Added a Toolpack page at `/toolpack`.
- Added a frontend API wrapper for `/api/toolpack/tools`, tool runs, cancellation, and artifact download.
- Registered the Toolpack route in the admin router and left navigation.
- Added schema-driven input rendering so new backend Toolpack manifests can appear in the UI without one-off frontend pages.
- Added compact result rendering for run status, summary, stdout, parsed records, and artifacts.

Reason:
- Backend Toolpack APIs were present, but users had no direct frontend entry to discover and run the tools.

Effect:
- Users can run `local.httpx`, `local.dnsx`, `local.ffuf`, `ssh.nmap`, and `ssh.sqlmap` through the same backend execution gateway used by Agent paths.

### fix plan: first intuitive verification issues

- Normalize local smoke-test defaults from port `8765` to the actual API port `8000`.
- Normalize `ssh_command` audit targets so they do not produce values such as `ssh://ssh://127.0.0.1:2222:2222`.
- Make Toolpack SSH tool availability explicit when the selected workspace is local.

Reason:
- `docs/C-verification-2026-07-15.md` found these as direct, low-risk issues that cause confusing validation and UI behavior.

Effect:
- Verification steps should produce clearer evidence before moving to deeper Runtime Permission and SSH credential work.

### fix: align Toolpack UI defaults and SSH availability

- Changed Toolpack UI defaults for `local.httpx` and `local.ffuf` from `127.0.0.1:8765` to `127.0.0.1:8000`.
- Updated the Windows SSH handoff document smoke-test URLs to use port `8000`.
- Normalized Agent `ssh_command` targets before authorization and audit recording.
- Made SSH Toolpack tools return `available=false` with `Linux-heavy tools require an SSH workspace` when the selected workspace is local.
- Added unit tests for SSH target normalization and local-workspace SSH Toolpack availability.

Reason:
- Verification found direct evidence that port `8765` was stale, SSH audit targets had duplicate `ssh://` prefixes, and SSH tools were unclear in the Toolpack list.

Effect:
- Frontend smoke defaults match the actual development API port.
- SSH command audit records should use stable `ssh://host:port` targets.
- The Toolpack UI can disable SSH tools on local Windows workspaces before the user starts a run.

### fix: align execution audit reason codes with permission source

- Changed `service.runtime_permissions.require_permission()` to return the actual grant source.
- Updated `core.execution_guard` to write that source into `executions.jsonl.reason_codes`.
- Added a unit test proving an always-allow grant is audited as `["always_allow"]`, not `["user_approved"]`.

Reason:
- Verification found `permissions.jsonl.source="always_allow"` while `executions.jsonl.reason_codes=["user_approved"]`, which could mislead audit review.

Effect:
- Execution audit now distinguishes stored always-allow rules from one-time user approvals.

### feat: add first-stage operations Toolpack tools

- Added `local.webcheck` for bounded HTTP health checks.
- Added `local.tls.inspect` for TLS certificate and cipher inspection.
- Added `local.port.scan` for small TCP port probes with a maximum of 32 ports.
- Implemented the tools with Python standard library scripts executed through the existing sandbox command gateway.
- Added Toolpack UI defaults for the new tools.
- Added unit coverage for manifest exposure, port-count policy enforcement, and `local.webcheck` output parsing.

Reason:
- The next C module milestone is to make Toolpack useful as an operations toolbox, not only a security scanner launcher.

Effect:
- Users can run low-risk diagnostics directly from `/toolpack` without installing extra binaries beyond the local Python runtime.
- The new tools still use the same Toolpack `ExecutionResult`, timeout, cancellation, artifact, and parsing path.

### feat: productize Toolpack UI and add more low-risk diagnostics

- Added `local.dns.lookup` for A / AAAA lookup through the local resolver.
- Added `local.ping` for bounded ping connectivity checks.
- Added `local.http.headers` for HEAD-based response header inspection with sensitive response headers filtered.
- Registered new operation action types in the C action registry and Agent runtime scope.
- Reworked `/toolpack` into a grouped Chinese toolbox UI:
  - 常用诊断
  - Web 检查
  - 网络检查
  - 安全测试
  - SSH/Linux
- Added Chinese tool names, descriptions, parameter labels, defaults, and result summary cards.

Reason:
- The project is being repositioned as a desktop security-learning and lightweight operations toolbox. This improves course-demo value without rewriting the Agent architecture.

Effect:
- Toolpack now has a clearer product shape for manual use, while preserving the same backend execution gateway and structured result contract.

### feat: complete SSH Workspace acceptance bridge

- Added Agent `ssh_command` credential resolution from the current SSH Workspace's Managed Host when `credential_ref` is empty.
- Made `ssh_command.target` optional when the current session is bound to an SSH Workspace.
- Added target matching so a Workspace host credential cannot be reused for a different SSH endpoint.
- Updated Agent runtime guidance to prefer the current SSH Workspace credentials instead of asking users for SSH secrets.
- Added host key preview and explicit trust APIs:
  - `GET /api/hosts/{id}/host-key`
  - `POST /api/hosts/{id}/host-key/trust`
- Added a Host Management UI trust button which displays the current SSH host key fingerprint before writing `.zj/ssh/known_hosts`.
- Added `docs/C-ssh-acceptance-guide.md` with the user-facing acceptance flow.
- Added unit tests for SSH Workspace credential reuse and host mismatch rejection.

Reason:
- The manual frontend flow could register SSH hosts and run SSH workspaces, but Agent SSH still required a separate `credential_ref`.
- First-use SSH host key enrollment also required manual file editing, which made the frontend acceptance flow incomplete.

Effect:
- A user can register a host once in the frontend, trust its SSH host key, create an SSH Workspace, run manual shell/Toolpack operations, and let Agent execute SSH commands through the same host after authorization.
- Agent no longer needs the user to repeat the SSH host IP when the current Workspace already identifies the Managed Host.
- Host key changes are still blocked by normal known_hosts verification unless the user explicitly trusts the new fingerprint.

### feat: add readable SSH execution workspace names

- Added editable Managed Host `display_name`.
- Added additive SQLite upgrade for existing portable databases.
- Backfilled the current local host as `本机` and existing SSH hosts as `WSL测试机`.
- Extended Workspace API payloads with host display name, SSH account, SSH port, and execution backend.
- Updated Host Management, Workspace creation, Toolpack, Workspace list, and Playground selector displays to use readable execution locations.

Reason:
- Workspace hashes such as `bf7ccfd59419` are useful as internal identifiers, but they are hard to remember during user acceptance and course demonstrations.

Effect:
- Users now see execution locations like `SSH · WSL测试机 · zj_sandbox@192.168.203.164:2222 · 运行中`.
- The hash remains available as secondary Workspace ID detail in dropdown options.

## Deferred Items

### D-TODO-1: L3 destructive pattern can be masked by always-allow in normal mode

Status: deferred.

Priority: P1 security hardening, not the next implementation blocker.

Reason:
- This is a real safety boundary issue, but it mainly affects cases where a user or prior workflow has already granted `always_allow` for a broad action such as `workspace.command.execute`.
- Most normal Toolpack and diagnostic flows do not depend on arbitrary destructive shell commands.
- Fixing it requires changing Runtime Permission precedence, so it should be handled with focused tests rather than mixed into tool expansion work.

Expected future behavior:
- In `mode=normal`, known L3 destructive patterns such as `rm -rf`, `Remove-Item -Recurse -Force`, `del /f /q`, `Format-Volume`, and `diskpart` should require a fresh approval even if a broad always-allow rule exists.
- In `mode=full_access`, current direct execution behavior may remain unchanged.

Next action when resumed:
- Add a destructive-pattern classifier near the execution guard.
- Check L3 destructive patterns before applying always-allow.
- Add tests for `always_allow + L3 command => pending approval`.
