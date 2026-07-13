# Third-Party Notices

## Z3r0

ZJ includes software derived from [Z3r0](https://github.com/yv1ing/Z3r0).

Copyright (c) 2026 yv1ing

Z3r0 is licensed under the MIT License. A copy of the original license is
included at `licenses/Z3r0-LICENSE`.

The imported baseline is upstream commit
`79776a2017d5863658a55b979f7a0972ce95a371` (2026-07-13). See
`docs/upstream-migration.md` for the migration inventory and adaptation notes.

## Bundled portable tools

Portable release builds may bundle separately executable third-party security
and runtime tools under `portable-tools/`. Each tool keeps its upstream license
and notice files. ZJ invokes these tools as separate processes and does not
incorporate their source into `zj-core`.

The development installer records exact downloaded versions in the release
build log. Redistributors must preserve the license files shipped beside every
tool and review the upstream redistribution terms before publishing a binary.
