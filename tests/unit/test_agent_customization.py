from __future__ import annotations

import json
import tempfile
import unittest
from http import HTTPStatus
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from config import AgentConfig, get_config
from core.agent import customization
from core.runtime.context import AgentRuntimeContext, AgentUserContext
from core.tools import sandbox
from schema.common.tool_results import ToolResultStatusSchema
from schema.system_config.agent_customization import (
    CreateSkillRequest,
    UpdateAgentPromptRequest,
    UpdateSkillRequest,
)
from schema.system_user.users import SystemUserRole
from service.agent import runtime as agent_runtime
from service.system_config import agent_customization


class AgentCustomizationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.custom_agents = root / "agent-overrides"
        self.custom_skills = root / "skills"
        self.previous_agents = get_config().agents
        get_config().agents = {"cso": AgentConfig(code="cso", name="CSO")}
        self.patches = [
            patch.object(customization, "CUSTOM_AGENT_DIR", self.custom_agents),
            patch.object(customization, "CUSTOM_SKILLS_DIR", self.custom_skills),
            patch.object(agent_customization, "CUSTOM_SKILLS_DIR", self.custom_skills),
            patch.object(agent_customization, "rebuild_agent_instances", new=AsyncMock()),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self) -> None:
        for item in reversed(self.patches):
            item.stop()
        get_config().agents = self.previous_agents
        self.tmp.cleanup()

    async def test_prompt_override_is_preferred_and_can_be_reset(self) -> None:
        builtin = agent_customization.get_agent_prompt("cso", "rules")

        updated = await agent_customization.update_agent_prompt(
            "cso",
            UpdateAgentPromptRequest(kind="rules", content="custom rules"),
        )
        self.assertTrue(updated.customized)
        self.assertEqual("custom rules", updated.content)

        reset = await agent_customization.delete_agent_prompt("cso", "rules")
        self.assertFalse(reset.customized)
        self.assertEqual(builtin.content, reset.content)

    async def test_custom_skill_shadows_builtin_and_load_skill_reads_it(self) -> None:
        await agent_customization.create_skill(
            CreateSkillRequest(name="nmap", content="# custom nmap\n\ncustom workflow"),
        )

        skills = agent_customization.list_skills().items
        nmap = next(item for item in skills if item.name == "nmap")
        self.assertEqual("custom", nmap.source)
        self.assertTrue(nmap.editable)

        context = AgentRuntimeContext(
            session_id="s1",
            user=AgentUserContext(
                id=1,
                username="admin",
                email="admin@example.local",
                role=SystemUserRole.ADMIN,
            ),
        )
        result = await sandbox.load_skill.on_invoke_tool(
            SimpleNamespace(context=context, run_config=None, tool_name="load_skill"),
            json.dumps({"name": "nmap"}),
        )
        payload = json.loads(result)
        self.assertEqual(ToolResultStatusSchema.SUCCESS.value, payload["status"])
        self.assertIn("custom workflow", payload["output"])

        metadata = agent_runtime._load_portable_skill_metadata()
        nmap_entries = [entry for entry in metadata if entry.startswith("## nmap")]
        self.assertEqual(1, len(nmap_entries))

    async def test_skill_name_and_builtin_mutation_are_rejected(self) -> None:
        with self.assertRaises(ValueError):
            customization.validate_skill_name("../escape")

        with self.assertRaises(HTTPException) as invalid_create:
            await agent_customization.create_skill(
                CreateSkillRequest(name="course_smoke", content="# invalid"),
            )
        self.assertEqual(HTTPStatus.BAD_REQUEST.value, invalid_create.exception.status_code)
        self.assertIn("lowercase letters", str(invalid_create.exception.detail))

        with self.assertRaises(Exception):
            await agent_customization.update_skill(
                "nmap",
                UpdateSkillRequest(content="# cannot edit builtin"),
            )

        with self.assertRaises(Exception):
            await agent_customization.delete_skill("nmap")

    async def test_custom_skill_can_be_updated_and_deleted(self) -> None:
        created = await agent_customization.create_skill(
            CreateSkillRequest(name="course-smoke", content="# course-smoke\n\nv1"),
        )
        self.assertEqual("course-smoke", created.name)

        updated = await agent_customization.update_skill(
            "course-smoke",
            UpdateSkillRequest(content="# course-smoke\n\nv2"),
        )
        self.assertIn("v2", updated.content)

        await agent_customization.delete_skill("course-smoke")
        names = {item.name for item in agent_customization.list_skills().items}
        self.assertNotIn("course-smoke", names)


if __name__ == "__main__":
    unittest.main()
