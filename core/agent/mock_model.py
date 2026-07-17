"""Deterministic model fixtures for D-group agent evaluations.

This module is intentionally independent from production provider configuration. Tests and CI can inject
``ScriptedMockModel`` where a real OpenAI-compatible provider would otherwise make the run nondeterministic.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from agents import (
    AgentOutputSchemaBase,
    Handoff,
    Model,
    ModelResponse,
    ModelSettings,
    ModelTracing,
    Tool,
    TResponseInputItem,
    Usage,
)
from openai.types.responses import (
    Response,
    ResponseCompletedEvent,
    ResponseContentPartAddedEvent,
    ResponseContentPartDoneEvent,
    ResponseFunctionToolCall,
    ResponseOutputItemAddedEvent,
    ResponseOutputItemDoneEvent,
    ResponseOutputMessage,
    ResponseOutputText,
    ResponseTextDeltaEvent,
    ResponseTextDoneEvent,
)
from openai.types.responses.response_prompt_param import ResponsePromptParam
from pydantic import BaseModel, Field

MockFailure = Literal["timeout", "disconnect", "token_limit"]
MockOutputType = Literal["message", "tool_call"]


class MockModelOutput(BaseModel):
    type: MockOutputType
    text: str = ""
    name: str = ""
    arguments: dict[str, Any] = Field(default_factory=dict)


class MockModelScenario(BaseModel):
    name: str
    outputs: list[MockModelOutput] = Field(default_factory=list)
    failure: MockFailure | None = None
    delay_seconds: float = Field(default=0, ge=0)


def load_mock_model_scenarios(path: str | Path) -> dict[str, MockModelScenario]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    scenarios = payload.get("scenarios", [])
    parsed = [MockModelScenario.model_validate(item) for item in scenarios]
    return {scenario.name: scenario for scenario in parsed}


class ScriptedMockModel(Model):
    """A deterministic OpenAI Agents SDK model implementation.

    Supported cases:
    - fixed assistant messages
    - fixed function tool calls
    - malformed structured text outputs
    - timeout, disconnect, and token-limit failures
    - streaming text/tool-call events for simple runtime smoke tests
    """

    def __init__(self, scenario: MockModelScenario | dict[str, Any], *, model: str = "zj-mock-model") -> None:
        self.scenario = (
            scenario if isinstance(scenario, MockModelScenario) else MockModelScenario.model_validate(scenario)
        )
        self.model = model
        self.calls: list[dict[str, Any]] = []

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
        self.calls.append({
            "system_instructions": system_instructions,
            "input": input,
            "tool_names": [getattr(tool, "name", "") for tool in tools],
            "previous_response_id": previous_response_id,
            "conversation_id": conversation_id,
        })
        await self._maybe_fail()
        output = [self._output_item(item, index) for index, item in enumerate(self.scenario.outputs)]
        return ModelResponse(
            output=output,
            usage=Usage(requests=1, output_tokens=sum(_output_token_estimate(item) for item in output)),
            response_id=f"mock-response-{uuid4().hex}",
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
    ) -> AsyncIterator:
        response = await self.get_response(
            system_instructions,
            input,
            model_settings,
            tools,
            output_schema,
            handoffs,
            tracing,
            previous_response_id=previous_response_id,
            conversation_id=conversation_id,
            prompt=prompt,
        )
        sequence = 1
        for output_index, item in enumerate(response.output):
            yield ResponseOutputItemAddedEvent(
                item=item,
                output_index=output_index,
                sequence_number=sequence,
                type="response.output_item.added",
            )
            sequence += 1
            if isinstance(item, ResponseOutputMessage) and item.content:
                part = item.content[0]
                yield ResponseContentPartAddedEvent(
                    content_index=0,
                    item_id=item.id,
                    output_index=output_index,
                    part=part,
                    sequence_number=sequence,
                    type="response.content_part.added",
                )
                sequence += 1
                if isinstance(part, ResponseOutputText):
                    yield ResponseTextDeltaEvent(
                        content_index=0,
                        delta=part.text,
                        item_id=item.id,
                        logprobs=[],
                        output_index=output_index,
                        sequence_number=sequence,
                        type="response.output_text.delta",
                    )
                    sequence += 1
                    yield ResponseTextDoneEvent(
                        content_index=0,
                        item_id=item.id,
                        logprobs=[],
                        output_index=output_index,
                        sequence_number=sequence,
                        text=part.text,
                        type="response.output_text.done",
                    )
                    sequence += 1
                yield ResponseContentPartDoneEvent(
                    content_index=0,
                    item_id=item.id,
                    output_index=output_index,
                    part=part,
                    sequence_number=sequence,
                    type="response.content_part.done",
                )
                sequence += 1
            yield ResponseOutputItemDoneEvent(
                item=item,
                output_index=output_index,
                sequence_number=sequence,
                type="response.output_item.done",
            )
            sequence += 1
        yield ResponseCompletedEvent(
            response=Response(
                id=response.response_id or f"mock-response-{uuid4().hex}",
                created_at=time.time(),
                model=self.model,
                object="response",
                output=response.output,
                parallel_tool_calls=False,
                status="completed",
                tool_choice="auto",
                tools=[],
            ),
            sequence_number=sequence,
            type="response.completed",
        )

    async def _maybe_fail(self) -> None:
        if self.scenario.delay_seconds:
            await asyncio.sleep(self.scenario.delay_seconds)
        if self.scenario.failure == "timeout":
            raise TimeoutError("scripted mock model timeout")
        if self.scenario.failure == "disconnect":
            raise ConnectionError("scripted mock model disconnect")
        if self.scenario.failure == "token_limit":
            raise RuntimeError("scripted mock model token limit exceeded")

    def _output_item(self, output: MockModelOutput, index: int):
        item_id = f"mock-item-{index}"
        if output.type == "message":
            return ResponseOutputMessage(
                id=item_id,
                content=[
                    ResponseOutputText(
                        annotations=[],
                        text=output.text,
                        type="output_text",
                    )
                ],
                role="assistant",
                status="completed",
                type="message",
            )
        if output.type == "tool_call":
            return ResponseFunctionToolCall(
                arguments=json.dumps(output.arguments, ensure_ascii=False),
                call_id=f"mock-call-{index}",
                id=item_id,
                name=output.name,
                status="completed",
                type="function_call",
            )
        raise ValueError(f"unsupported mock output type: {output.type}")


def _output_token_estimate(item: object) -> int:
    if isinstance(item, ResponseOutputMessage):
        text = "".join(part.text for part in item.content if isinstance(part, ResponseOutputText))
        return max(1, len(text.split()))
    if isinstance(item, ResponseFunctionToolCall):
        return max(1, len(item.arguments.split()) + 1)
    return 1
