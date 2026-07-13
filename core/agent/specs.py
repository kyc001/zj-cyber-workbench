from dataclasses import dataclass

from agents import Tool

from core.tools.reports import export_report
from core.tools.work_project import (
    create_or_update_work_project_asset,
    create_or_update_work_project_attack_path,
    create_or_update_work_project_attack_path_step,
    create_or_update_work_project_finding,
    create_or_update_work_project_graph_edge,
    delete_work_project_record,
    list_work_project_assets,
    list_work_project_findings,
    load_work_project_agent_summaries,
    load_work_project_graph,
    load_work_project_metadata,
    load_work_project_tasks,
    update_work_project_agent_summary,
    update_work_project_tasks,
)


@dataclass(frozen=True, slots=True)
class ToolMount:
    tool: Tool
    requires_work_project: bool = False


@dataclass(frozen=True, slots=True)
class SubagentMount:
    code: str


@dataclass(frozen=True, slots=True)
class AgentSpec:
    code: str
    tools: tuple[ToolMount, ...] = ()
    subagents: tuple[SubagentMount, ...] = ()


WORK_PROJECT_TOOLS = (
    ToolMount(load_work_project_metadata, requires_work_project=True),
    ToolMount(load_work_project_tasks, requires_work_project=True),
    ToolMount(load_work_project_agent_summaries, requires_work_project=True),
    ToolMount(update_work_project_agent_summary, requires_work_project=True),
)

WORK_PROJECT_RECORD_TOOLS = (
    ToolMount(list_work_project_assets, requires_work_project=True),
    ToolMount(create_or_update_work_project_asset, requires_work_project=True),
    ToolMount(list_work_project_findings, requires_work_project=True),
    ToolMount(create_or_update_work_project_finding, requires_work_project=True),
    ToolMount(load_work_project_graph, requires_work_project=True),
    ToolMount(create_or_update_work_project_graph_edge, requires_work_project=True),
    ToolMount(create_or_update_work_project_attack_path, requires_work_project=True),
    ToolMount(create_or_update_work_project_attack_path_step, requires_work_project=True),
    ToolMount(delete_work_project_record, requires_work_project=True),
)

SPECIALIST_TOOLS = (
    *WORK_PROJECT_TOOLS,
    *WORK_PROJECT_RECORD_TOOLS,
)

AGENT_SPECS: tuple[AgentSpec, ...] = (
    AgentSpec(
        code="cso",
        tools=(
            *WORK_PROJECT_TOOLS,
            *WORK_PROJECT_RECORD_TOOLS,
            ToolMount(update_work_project_tasks, requires_work_project=True),
            ToolMount(export_report),
        ),
        subagents=(
            SubagentMount(code="cae"),
            SubagentMount(code="cce"),
            SubagentMount(code="cie"),
            SubagentMount(code="cpe"),
            SubagentMount(code="cre"),
        ),
    ),
    AgentSpec(code="cae", tools=SPECIALIST_TOOLS),
    AgentSpec(code="cce", tools=SPECIALIST_TOOLS),
    AgentSpec(code="cie", tools=SPECIALIST_TOOLS),
    AgentSpec(code="cpe", tools=SPECIALIST_TOOLS),
    AgentSpec(code="cre", tools=SPECIALIST_TOOLS),
)
