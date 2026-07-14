from config import BUNDLED_SKILLS_DIR
from core.execution_guard import extract_urls
from core.runtime.context import AgentRuntimeContext, AgentUserContext, main_agent_instance_id
from core.runtime.input_items import display_text_from_content
from core.runtime.session import get_agent_pool
from middleware.auth import AuthUser
from schema.agent.events import AgentEventSchema, AgentInputPart
from service.agent import sessions as agent_sessions
from service.sandbox.lifecycle import ensure_default_portable_workspace
from service.sandbox.status import (
    resolve_project_sandbox_container_tool_binding,
    resolve_sandbox_container_selection,
    resolve_sandbox_container_tool_binding,
)
from service.work_project.projects import (
    can_run_work_project_session,
    sandbox_container_id_for_work_project,
    work_project_allows_sandbox_container,
)

_MAX_SANDBOX_SKILLS = 64
_SKILLS_DIR = BUNDLED_SKILLS_DIR


class SessionNotRunnableError(PermissionError):
    pass


class SessionBusyError(RuntimeError):
    pass


class AgentUnavailableError(ValueError):
    pass


async def submit_user_turn(
    *,
    session_id: str,
    content: list[AgentInputPart],
    user: AuthUser,
    sandbox_container_id: int | None,
    requested_agent_code: str | None,
) -> list[AgentEventSchema]:
    await apply_turn_sandbox_selection(
        session_id=session_id,
        sandbox_container_id=sandbox_container_id,
        user=user,
    )
    return await submit_turn(
        session_id=session_id,
        content=content,
        user=user,
        sandbox_container_id=sandbox_container_id,
        requested_agent_code=requested_agent_code,
    )


async def submit_turn(
    *,
    session_id: str,
    content: list[AgentInputPart],
    user: AuthUser,
    sandbox_container_id: int | None,
    requested_agent_code: str | None,
) -> list[AgentEventSchema]:
    if not await agent_sessions.can_access_session(session_id, user.id, user.role):
        raise PermissionError("agent session not found")
    if not await can_run_work_project_session(session_id, user.id, user.role):
        raise SessionNotRunnableError("work project is canceled")
    if requested_agent_code is not None and not get_agent_pool().registry.has(requested_agent_code):
        raise AgentUnavailableError("agent is not available")

    display_text = display_text_from_content(content)
    agent_code = await agent_sessions.ensure_chat_session_meta(
        session_id,
        display_text,
        requested_agent_code,
        user_id=user.id,
        user_role=user.role,
    )
    context = await build_runtime_context(
        session_id,
        user,
        agent_code,
        sandbox_container_id=sandbox_container_id,
        allowed_targets=extract_urls(display_text),
    )
    runtime = await get_agent_pool().get_or_create(session_id)
    return await runtime.start_turn(content, agent_code, context)


async def submit_new_chat_turn(
    *,
    content: list[AgentInputPart],
    user: AuthUser,
    sandbox_container_id: int | None,
    requested_agent_code: str | None,
) -> tuple[str, list[AgentEventSchema]]:
    session_id = await agent_sessions.create_session(user_id=user.id)
    try:
        await apply_turn_sandbox_selection(
            session_id=session_id,
            sandbox_container_id=sandbox_container_id,
            user=user,
        )
        events = await submit_turn(
            session_id=session_id,
            content=content,
            user=user,
            sandbox_container_id=sandbox_container_id,
            requested_agent_code=requested_agent_code,
        )
    except Exception:
        await agent_sessions.delete_session(
            session_id,
            user_id=user.id,
            user_role=user.role,
        )
        raise
    return session_id, events


async def interrupt_turn(*, session_id: str, user: AuthUser) -> list[AgentEventSchema]:
    await _raise_unless_can_access(session_id, user)
    return await get_agent_pool().try_interrupt(session_id)


async def cancel_all_tasks(*, session_id: str, user: AuthUser) -> list[AgentEventSchema]:
    await _raise_unless_can_access(session_id, user)
    return await get_agent_pool().cancel_all(session_id)


async def _raise_unless_can_access(session_id: str, user: AuthUser) -> None:
    if not await agent_sessions.can_access_session(session_id, user.id, user.role):
        raise PermissionError("agent session not found")


async def apply_turn_sandbox_selection(
    *,
    session_id: str,
    sandbox_container_id: int | None,
    user: AuthUser,
) -> None:
    meta = await agent_sessions.get_accessible_session_meta(session_id, user.id, user.role)
    if meta is None:
        raise PermissionError("agent session not found")
    if meta.project_id is not None:
        bound = await sandbox_container_id_for_work_project(meta.project_id)
        if sandbox_container_id is not None and sandbox_container_id != bound:
            raise ValueError("项目会话只能使用项目绑定的执行工作区")
        generation = 0
        if bound is not None:
            selection = await resolve_sandbox_container_selection(
                id=bound,
                user_id=user.id,
                user_role=user.role,
            )
            generation = selection.generation if selection is not None else 0
        if (
            meta.selected_sandbox_container_id != bound
            or meta.selected_sandbox_container_generation != generation
        ):
            await agent_sessions.update_session_sandbox_container(
                session_id=session_id,
                sandbox_container_id=bound,
                sandbox_container_generation=generation,
                user_id=user.id,
                user_role=user.role,
            )
        return
    current = meta.selected_sandbox_container_id
    if sandbox_container_id is None:
        sandbox_container_id = current or await ensure_default_portable_workspace(user.id)
    if current == sandbox_container_id:
        return
    await update_selected_sandbox_container(
        session_id=session_id,
        sandbox_container_id=sandbox_container_id,
        user=user,
        require_idle=True,
    )


async def update_selected_sandbox_container(
    *,
    session_id: str,
    sandbox_container_id: int | None,
    user: AuthUser,
    require_idle: bool = True,
) -> object:
    meta = await agent_sessions.get_accessible_session_meta(session_id, user.id, user.role)
    if meta is None:
        raise PermissionError("agent session not found")
    if meta.project_id is not None:
        raise ValueError("项目会话只能使用项目绑定的执行工作区")
    if require_idle and (meta.is_running or await agent_sessions.has_outstanding_session_work(session_id)):
        raise SessionBusyError("请先停止当前会话任务，再切换执行工作区")
    generation = 0
    if sandbox_container_id is not None:
        selection = await resolve_sandbox_container_selection(
            id=sandbox_container_id,
            user_id=user.id,
            user_role=user.role,
        )
        if selection is None:
            raise ValueError("执行工作区不可用")
        generation = selection.generation
    summary = await agent_sessions.update_session_sandbox_container(
        session_id=session_id,
        sandbox_container_id=sandbox_container_id,
        sandbox_container_generation=generation,
        user_id=user.id,
        user_role=user.role,
    )
    if summary is None:
        raise PermissionError("agent session not found")
    await get_agent_pool().invalidate_session_tool_binding(session_id)
    return summary


async def build_runtime_context(
    session_id: str,
    user: AuthUser,
    agent_code: str = "",
    *,
    sandbox_container_id: int | None = None,
    allowed_targets: tuple[str, ...] = (),
) -> AgentRuntimeContext:
    work_project_id = await agent_sessions.project_id_for_session(session_id)
    meta = await agent_sessions.get_session_meta(session_id)
    if work_project_id is not None:
        sandbox_container_id = await sandbox_container_id_for_work_project(work_project_id)
    elif sandbox_container_id is None and meta is not None:
        sandbox_container_id = (
            meta.runtime_sandbox_container_id
            if meta.is_running
            else meta.selected_sandbox_container_id
        )
    if sandbox_container_id is None:
        sandbox_container_id = await ensure_default_portable_workspace(user.id)
    binding = await resolve_sandbox_container_tool_binding(
        id=sandbox_container_id,
        user_id=user.id,
        user_role=user.role,
    )
    if work_project_id is not None:
        allowed = await work_project_allows_sandbox_container(
            project_id=work_project_id,
            sandbox_container_id=sandbox_container_id,
            user_id=user.id,
            user_role=user.role,
        )
        binding = await resolve_project_sandbox_container_tool_binding(sandbox_container_id) if allowed else None
    selected_id = binding.id if binding is not None else None
    selected_generation = binding.generation if binding is not None else 0
    sandbox_skill_metadata = _load_portable_skill_metadata() if binding is not None else ()
    return AgentRuntimeContext(
        session_id=session_id,
        user=_agent_user_context(user),
        agent_code=agent_code,
        agent_instance_id=main_agent_instance_id(session_id, user.id, agent_code) if agent_code else "",
        work_project_id=work_project_id,
        sandbox_container_id=selected_id,
        sandbox_container_generation=selected_generation,
        sandbox_skill_metadata=sandbox_skill_metadata,
        allowed_targets=allowed_targets,
        allowed_action_types=(
            "web.http.health", "web.http.headers", "web.tls.inspect", "security.web.scan",
            "network.dns.lookup", "network.ping", "network.port.probe",
            "host.local.diagnostic", "ssh.command",
        ),
        scope_id=f"session:{session_id}",
    )


def _load_portable_skill_metadata() -> tuple[str, ...]:
    entries: list[str] = []
    if not _SKILLS_DIR.is_dir():
        return ()
    for skill_file in sorted(_SKILLS_DIR.glob("*/SKILL.md"))[:_MAX_SANDBOX_SKILLS]:
        name = skill_file.parent.name
        description = ""
        try:
            lines = skill_file.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        if lines and lines[0].strip() == "---":
            for line in lines[1:]:
                if line.strip() == "---":
                    break
                if line.startswith("description:"):
                    description = line.partition(":")[2].strip()
        entries.append(f"## {name}\n\n- description: {description or 'Portable tool workflow'}")
    return tuple(entries)


def _agent_user_context(user: AuthUser) -> AgentUserContext:
    return AgentUserContext(
        id=user.id,
        username=user.username,
        email=user.email,
        role=user.role,
    )
