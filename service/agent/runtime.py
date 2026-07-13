from core.runtime.context import AgentRuntimeContext, AgentUserContext, main_agent_instance_id
from core.runtime.input_items import display_text_from_content
from core.runtime.session import get_agent_pool
from middleware.auth import AuthUser
from schema.agent.events import AgentEventSchema, AgentInputPart
from service.agent import sessions as agent_sessions
from service.work_project.projects import can_run_work_project_session


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
    requested_agent_code: str | None,
) -> list[AgentEventSchema]:
    return await submit_turn(
        session_id=session_id,
        content=content,
        user=user,
        requested_agent_code=requested_agent_code,
    )


async def submit_turn(
    *,
    session_id: str,
    content: list[AgentInputPart],
    user: AuthUser,
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
    context = await build_runtime_context(session_id, user, agent_code)
    runtime = await get_agent_pool().get_or_create(session_id)
    return await runtime.start_turn(content, agent_code, context)


async def submit_new_chat_turn(
    *,
    content: list[AgentInputPart],
    user: AuthUser,
    requested_agent_code: str | None,
) -> tuple[str, list[AgentEventSchema]]:
    session_id = await agent_sessions.create_session(user_id=user.id)
    try:
        events = await submit_turn(
            session_id=session_id,
            content=content,
            user=user,
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


async def build_runtime_context(
    session_id: str,
    user: AuthUser,
    agent_code: str = "",
) -> AgentRuntimeContext:
    work_project_id = await agent_sessions.project_id_for_session(session_id)
    return AgentRuntimeContext(
        session_id=session_id,
        user=_agent_user_context(user),
        agent_code=agent_code,
        agent_instance_id=main_agent_instance_id(session_id, user.id, agent_code) if agent_code else "",
        work_project_id=work_project_id,
    )


def _agent_user_context(user: AuthUser) -> AgentUserContext:
    return AgentUserContext(
        id=user.id,
        username=user.username,
        email=user.email,
        role=user.role,
    )
