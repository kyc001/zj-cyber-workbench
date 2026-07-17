"""Model construction for configured agents.

Production agents use a native OpenAI-compatible model. D-group verification can opt into a
deterministic scripted mock by setting an agent model/base URL to an explicit mock scenario.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from pathlib import Path
from urllib.parse import urlsplit

from agents import (
    AgentOutputSchemaBase,
    Handoff,
    Model,
    ModelResponse,
    ModelRetryAdvice,
    ModelRetryAdviceRequest,
    ModelSettings,
    ModelTracing,
    Tool,
    TResponseInputItem,
)
from agents.models.openai_provider import OpenAIProvider
from agents.stream_events import TResponseStreamEvent
from openai import AsyncOpenAI
from openai.types.responses.response_prompt_param import ResponsePromptParam

from config import AgentConfig
from core.agent.mock_model import ScriptedMockModel, load_mock_model_scenarios
from core.agent.model_input import ModelInputAdapter

_MOCK_SCHEME = "mock"
_MOCK_MODEL_PREFIXES = ("mock:", "zj-mock:")
_MOCK_SCENARIO_ENV = "ZJ_MOCK_MODEL_SCENARIOS"


class ZJOpenAIModel(Model):
    def __init__(self, cfg: AgentConfig) -> None:
        self.model = cfg.model
        self._input_adapter = ModelInputAdapter()
        self._client = AsyncOpenAI(
            api_key=cfg.api_key or ("unused" if cfg.base_url else None),
            base_url=cfg.base_url or None,
        )
        self._provider = OpenAIProvider(
            openai_client=self._client,
            use_responses=cfg.use_responses,
        )
        self._model = self._provider.get_model(cfg.model)

    def get_retry_advice(self, request: ModelRetryAdviceRequest) -> ModelRetryAdvice | None:
        return self._model.get_retry_advice(request)

    async def get_response(
        self,
        system_instructions: str | None,
        input: str | list[TResponseInputItem],
        model_settings: ModelSettings,
        tools: list[Tool],
        output_schema: AgentOutputSchemaBase | None,
        handoffs: list[Handoff],
        tracing: ModelTracing,
        *,
        previous_response_id: str | None,
        conversation_id: str | None,
        prompt: ResponsePromptParam | None,
    ) -> ModelResponse:
        return await self._model.get_response(
            system_instructions,
            self._input_adapter.adapt(input),
            model_settings,
            tools,
            output_schema,
            handoffs,
            tracing,
            previous_response_id=previous_response_id,
            conversation_id=conversation_id,
            prompt=prompt,
        )

    async def stream_response(
        self,
        system_instructions: str | None,
        input: str | list[TResponseInputItem],
        model_settings: ModelSettings,
        tools: list[Tool],
        output_schema: AgentOutputSchemaBase | None,
        handoffs: list[Handoff],
        tracing: ModelTracing,
        *,
        previous_response_id: str | None,
        conversation_id: str | None,
        prompt: ResponsePromptParam | None,
    ) -> AsyncIterator[TResponseStreamEvent]:
        async for event in self._model.stream_response(
            system_instructions,
            self._input_adapter.adapt(input),
            model_settings,
            tools,
            output_schema,
            handoffs,
            tracing,
            previous_response_id=previous_response_id,
            conversation_id=conversation_id,
            prompt=prompt,
        ):
            yield event

    async def close(self) -> None:
        await self._model.close()
        await self._provider.aclose()
        await self._client.close()


def build_openai_model(cfg: AgentConfig) -> Model:
    mock_model = _build_mock_model(cfg)
    if mock_model is not None:
        return mock_model
    return ZJOpenAIModel(cfg)


def _build_mock_model(cfg: AgentConfig) -> ScriptedMockModel | None:
    scenario_name = _mock_scenario_name(cfg)
    if not scenario_name:
        return None

    scenarios = load_mock_model_scenarios(_mock_scenario_file())
    try:
        scenario = scenarios[scenario_name]
    except KeyError as exc:
        raise ValueError(f"mock model scenario not found: {scenario_name}") from exc
    return ScriptedMockModel(scenario, model=cfg.model or f"zj-mock:{scenario_name}")


def _mock_scenario_name(cfg: AgentConfig) -> str:
    base_url = cfg.base_url.strip()
    if base_url:
        parsed = urlsplit(base_url)
        if parsed.scheme == _MOCK_SCHEME:
            return f"{parsed.netloc}{parsed.path}".strip("/")

    model = cfg.model.strip()
    for prefix in _MOCK_MODEL_PREFIXES:
        if model.startswith(prefix):
            return model.removeprefix(prefix).strip()
    return ""


def _mock_scenario_file() -> Path:
    configured = os.environ.get(_MOCK_SCENARIO_ENV, "").strip()
    if configured:
        return Path(configured).expanduser().resolve()

    default = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "d_agent" / "mock_model_scenarios.json"
    if default.is_file():
        return default
    raise ValueError(f"{_MOCK_SCENARIO_ENV} must point to mock_model_scenarios.json")
