"""Agent declarations and session-bound SDK Agent construction."""

from __future__ import annotations

from dataclasses import dataclass

from agents import (
    Agent,
    Model,
    ModelSettings,
    Tool,
)

from config import AgentConfig, BUNDLED_AGENT_DIR, get_config
from core.agent.instructions import build_instructions
from core.agent.models import build_openai_model
from core.agent.specs import AGENT_SPECS, AgentSpec, ToolMount
from core.delegation.subagents import build_subagent_tools
from core.runtime.context import AgentRuntimeContext
from core.tools.reports import export_report


@dataclass(frozen=True, slots=True)
class AgentToolSnapshot:
    work_project_id: int | None = None

    @classmethod
    def from_context(cls, context: AgentRuntimeContext) -> "AgentToolSnapshot":
        return cls(
            work_project_id=context.work_project_id,
        )


class AgentRegistry:
    def __init__(self, specs: tuple[AgentSpec, ...] = AGENT_SPECS) -> None:
        self._specs: dict[str, AgentSpec] = {spec.code: spec for spec in specs}
        self._codes_cache: tuple[str, ...] | None = None
        self._code_to_name_cache: dict[str, str] | None = None
        # Reject self-mounts and circular subagent chains at boot.
        self._validate_subagent_graph()

    def codes(self) -> list[str]:
        if self._codes_cache is None:
            configured = set(get_config().agents.keys())
            self._codes_cache = tuple(code for code in self._specs if code in configured)
        return list(self._codes_cache)

    def code_to_name(self) -> dict[str, str]:
        if self._code_to_name_cache is None:
            cfg = get_config()
            self._code_to_name_cache = {code: cfg.agents[code].name for code in self.codes()}
        return self._code_to_name_cache

    def has(self, agent_code: str) -> bool:
        return agent_code in self.codes()

    def bind(self, tool_snapshot: AgentToolSnapshot) -> SessionAgentGraph:
        return SessionAgentGraph(self, tool_snapshot)

    def _spec(self, agent_code: str) -> AgentSpec:
        spec = self._specs.get(agent_code)
        if spec is None:
            raise ValueError(f"agent spec not declared for code: {agent_code}")
        return spec

    def _validate_subagent_graph(self) -> None:
        for code in self._specs:
            self._check_subagent_chain(code, [code])

    def _check_subagent_chain(self, code: str, path: list[str]) -> None:
        spec = self._specs.get(code)
        if spec is None:
            return
        for mount in spec.subagents:
            if mount.code == code:
                raise ValueError(f"agent {code} cannot mount itself as a subagent")
            if mount.code in path:
                chain = " -> ".join([*path, mount.code])
                raise ValueError(f"circular subagent mount detected: {chain}")
            self._check_subagent_chain(mount.code, [*path, mount.code])

    def _build(self, spec: AgentSpec, cfg: AgentConfig, graph: SessionAgentGraph) -> Agent:
        agent_path = BUNDLED_AGENT_DIR / spec.code
        soul = (agent_path / "SOUL.md").read_text(encoding="utf-8").strip()
        rules = (agent_path / "AGENTS.md").read_text(encoding="utf-8").strip()
        instructions = build_instructions(
            soul,
            rules,
            include_work_project_tools=(
                graph.tool_snapshot.work_project_id is not None
                and _has_work_project_tool(spec)
            ),
            include_delegation_tools=bool(spec.subagents),
            include_report_tools=_has_tool(spec, export_report),
        )

        tools: list[Tool] = [
            mount.tool for mount in spec.tools
            if _tool_mount_available(mount, graph.tool_snapshot)
        ]
        if spec.subagents:
            tools.extend(_build_subagent_tools(spec, self))

        return Agent(
            name=cfg.name,
            model=build_openai_model(cfg),
            model_settings=ModelSettings(parallel_tool_calls=False),
            instructions=lambda run_context, _: "\n\n".join(
                part for part in (instructions, run_context.context.rag_context) if part
            ),
            tools=tools,
        )


class SessionAgentGraph:
    """Single-owner container for an Agent and its httpx client.

    Each driver (main session or one sub-agent) binds its own graph, so
    disposing one graph never tears down a sibling's in-flight HTTP stream.
    """

    def __init__(self, registry: AgentRegistry, tool_snapshot: AgentToolSnapshot) -> None:
        self._registry = registry
        self.tool_snapshot = tool_snapshot
        self._agents: dict[str, Agent] = {}
        self._models: list[Model] = []

    def code_to_name(self) -> dict[str, str]:
        return self._registry.code_to_name()

    def get(self, agent_code: str) -> Agent:
        cached = self._agents.get(agent_code)
        if cached is not None:
            return cached

        spec = self._registry._spec(agent_code)
        cfg = get_config().agents.get(agent_code)
        if cfg is None:
            raise ValueError(f"agent config missing for code: {agent_code}")

        agent = self._registry._build(spec, cfg, self)
        self._agents[agent_code] = agent
        self._models.append(agent.model)
        return agent

    async def close(self) -> None:
        for model in self._models:
            await model.close()
        self._agents.clear()
        self._models.clear()


def _has_tool(spec: AgentSpec, tool: Tool) -> bool:
    return any(mount.tool is tool for mount in spec.tools)


def _has_work_project_tool(spec: AgentSpec) -> bool:
    return any(mount.requires_work_project for mount in spec.tools)


def _tool_mount_available(mount: ToolMount, snapshot: AgentToolSnapshot) -> bool:
    if mount.requires_work_project and snapshot.work_project_id is None:
        return False
    return True


def _build_subagent_tools(spec: AgentSpec, registry: AgentRegistry) -> list[Tool]:
    return build_subagent_tools(
        spec.code,
        (mount.code for mount in spec.subagents),
        registry=registry,
    )
