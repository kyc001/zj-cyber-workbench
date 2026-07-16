"""Report reference reconciliation helpers for D-group quality gates."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal

ReferenceKind = Literal["timeline", "tool", "finding", "approval", "artifact", "changeset"]

_REFERENCE_PATTERN = re.compile(
    r"\b(?P<kind>timeline|tool|finding|approval|artifact|changeset):(?P<identifier>[A-Za-z0-9_.:-]+)\b"
)


@dataclass(frozen=True, slots=True)
class ReportReference:
    kind: ReferenceKind
    identifier: str


@dataclass(frozen=True, slots=True)
class ReportReconciliationResult:
    references: tuple[ReportReference, ...]
    covered: tuple[ReportReference, ...]
    missing: tuple[ReportReference, ...]

    @property
    def ok(self) -> bool:
        return not self.missing


def extract_report_references(content: str) -> tuple[ReportReference, ...]:
    seen: set[tuple[str, str]] = set()
    references: list[ReportReference] = []
    for match in _REFERENCE_PATTERN.finditer(content):
        kind = match.group("kind")
        identifier = match.group("identifier").rstrip(".,;)")
        key = (kind, identifier)
        if key in seen:
            continue
        seen.add(key)
        references.append(ReportReference(kind=kind, identifier=identifier))  # type: ignore[arg-type]
    return tuple(references)


def reconcile_report_with_timeline(
    content: str,
    timeline_events: list[dict[str, Any]],
    *,
    known_findings: set[str] | None = None,
    known_approvals: set[str] | None = None,
    known_artifacts: set[str] | None = None,
    known_changesets: set[str] | None = None,
) -> ReportReconciliationResult:
    references = extract_report_references(content)
    timeline_seq = {str(event.get("seq")) for event in timeline_events if event.get("seq") not in (None, 0)}
    tool_call_ids = {
        str(event.get("call_id"))
        for event in timeline_events
        if event.get("type") in {"tool_call", "tool_result"} and event.get("call_id")
    }
    artifact_ids = set(known_artifacts or set()) | _artifact_ids_from_timeline(timeline_events)

    covered: list[ReportReference] = []
    missing: list[ReportReference] = []
    for reference in references:
        if _reference_exists(
            reference,
            timeline_seq=timeline_seq,
            tool_call_ids=tool_call_ids,
            known_findings=known_findings or set(),
            known_approvals=known_approvals or set(),
            known_artifacts=artifact_ids,
            known_changesets=known_changesets or set(),
        ):
            covered.append(reference)
        else:
            missing.append(reference)
    return ReportReconciliationResult(
        references=references,
        covered=tuple(covered),
        missing=tuple(missing),
    )


def _reference_exists(
    reference: ReportReference,
    *,
    timeline_seq: set[str],
    tool_call_ids: set[str],
    known_findings: set[str],
    known_approvals: set[str],
    known_artifacts: set[str],
    known_changesets: set[str],
) -> bool:
    if reference.kind == "timeline":
        return reference.identifier in timeline_seq
    if reference.kind == "tool":
        return reference.identifier in tool_call_ids
    if reference.kind == "finding":
        return reference.identifier in known_findings
    if reference.kind == "approval":
        return reference.identifier in known_approvals
    if reference.kind == "artifact":
        return reference.identifier in known_artifacts
    if reference.kind == "changeset":
        return reference.identifier in known_changesets
    return False


def _artifact_ids_from_timeline(timeline_events: list[dict[str, Any]]) -> set[str]:
    artifact_ids: set[str] = set()
    for event in timeline_events:
        output = event.get("output")
        if isinstance(output, str):
            artifact_ids.update(
                match.group("identifier")
                for match in _REFERENCE_PATTERN.finditer(output)
                if match.group("kind") == "artifact"
            )
        payload = event.get("artifact_id")
        if payload:
            artifact_ids.add(str(payload))
    return artifact_ids
