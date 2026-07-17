# Contributing to ZJ

## Scope and Safety

Use only local, mock, or explicitly authorized test targets. Tests must not scan public networks, embed credentials, weaken approval checks, or require a paid model in CI.

## Development

```powershell
./scripts/dev.ps1 doctor
./scripts/dev.ps1 install
./scripts/dev.ps1 ui
```

Keep changes within the owning module, follow existing patterns, and add tests proportional to the behavior changed. Public schema changes must update the schema, OpenAPI output, generated TypeScript types, tests, and `docs/team-handoff.md` when relevant.

## Required Checks

```powershell
uv run python -m unittest discover -s tests -p "test_*.py"
uv run ruff check .
pnpm typecheck
pnpm build
```

D-group Agent and browser checks:

```powershell
pnpm test:d-runtime
pnpm test:d-web
```

## Pull Requests

Describe the behavior change, tests run, security impact, migration needs, known limitations, and rollback method. Never commit `.env`, `.zj/`, `data/`, databases, logs, generated test traces, API keys, SSH credentials, or private target information.

Commits should be focused and use an imperative summary, for example `Add mock runtime persistence test`.
