import asyncio
import json
import unittest
from pathlib import Path

from agents import ModelSettings
from openai.types.responses import ResponseFunctionToolCall, ResponseOutputMessage

from core.agent.mock_model import ScriptedMockModel, load_mock_model_scenarios
from core.agent.report_reconciliation import extract_report_references, reconcile_report_with_timeline
from core.agent.specs import AGENT_SPECS

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests" / "fixtures" / "d_agent"


class DAgentQualityAssetTests(unittest.TestCase):
    def test_agent_operating_spec_defines_all_product_roles(self) -> None:
        content = (ROOT / "docs" / "d-agent-operating-spec.md").read_text(encoding="utf-8")
        for role in (
            "Ops Lead",
            "Diagnostic Engineer",
            "Security Engineer",
            "Load Test Engineer",
            "Remediation Engineer",
            "Verification Engineer",
            "Evidence Reporter",
        ):
            self.assertIn(role, content)
        self.assertIn("LoadPlan", content)

    def test_permission_matrix_covers_registered_runtime_tools(self) -> None:
        payload = json.loads((FIXTURES / "tool_permission_matrix.json").read_text(encoding="utf-8"))
        permissions = payload["permissions"]
        registered = {
            getattr(mount.tool, "name", "")
            for spec in AGENT_SPECS
            for mount in spec.tools
        }
        missing = sorted(tool for tool in registered if tool and tool not in permissions)
        self.assertEqual([], missing)
        self.assertIn("load_test_engineer", payload["roles"])
        for tool in payload["never_allowed_for_reporter"]:
            self.assertNotIn("evidence_reporter", permissions[tool])

    def test_prompt_injection_fixture_covers_required_attack_classes(self) -> None:
        payload = json.loads((FIXTURES / "prompt_injection_cases.json").read_text(encoding="utf-8"))
        cases = payload["cases"]
        goals = {case["attack_goal"] for case in cases}
        self.assertTrue({
            "override_system_rules_and_exfiltrate_secret",
            "credential_exfiltration",
            "forge_approval",
            "expand_scope",
            "induce_privilege_escalation",
            "forge_tool_result",
            "bypass_approval",
            "bypass_load_limits_by_splitting",
        }.issubset(goals))
        for case in cases:
            self.assertTrue(case["must_not"])
            self.assertTrue(case["assertions"])

    def test_scripted_mock_model_message_and_tool_call(self) -> None:
        scenarios = load_mock_model_scenarios(FIXTURES / "mock_model_scenarios.json")

        text_model = ScriptedMockModel(scenarios["diagnostic_text"])
        text_response = asyncio.run(_get_response(text_model))
        self.assertIsInstance(text_response.output[0], ResponseOutputMessage)
        self.assertIn("Observation", text_response.output[0].content[0].text)

        tool_model = ScriptedMockModel(scenarios["fixed_tool_call"])
        tool_response = asyncio.run(_get_response(tool_model))
        self.assertIsInstance(tool_response.output[0], ResponseFunctionToolCall)
        self.assertEqual("http_request", tool_response.output[0].name)

    def test_scripted_mock_model_streams_and_failures_are_deterministic(self) -> None:
        scenarios = load_mock_model_scenarios(FIXTURES / "mock_model_scenarios.json")

        events = asyncio.run(_stream_events(ScriptedMockModel(scenarios["diagnostic_text"])))
        self.assertIn("response.output_text.delta", {event.type for event in events})

        with self.assertRaises(TimeoutError):
            asyncio.run(_get_response(ScriptedMockModel(scenarios["timeout"])))
        with self.assertRaises(ConnectionError):
            asyncio.run(_get_response(ScriptedMockModel(scenarios["disconnect"])))
        with self.assertRaises(RuntimeError):
            asyncio.run(_get_response(ScriptedMockModel(scenarios["token_limit"])))

    def test_core_e2e_fixture_contains_the_required_release_path(self) -> None:
        payload = json.loads((FIXTURES / "core_e2e_scenarios.json").read_text(encoding="utf-8"))
        scenario = payload["scenarios"][0]
        self.assertEqual("core-incident-loop", scenario["id"])
        self.assertEqual(
            [
                "cold_start_with_temp_data_dir",
                "configure_mock_model",
                "create_project_scope",
                "select_workspace",
                "ops_lead_plan",
                "diagnostic_read_only_checks",
                "remediation_changeset",
                "policy_evaluate",
                "approval_required",
                "execute_approved_action",
                "verification_independent_check",
                "export_report",
                "restart_and_verify_persistence",
            ],
            scenario["steps"],
        )
        self.assertIn("unapproved_write", scenario["must_block"])
        self.assertIn("missing_report_reference", scenario["must_block"])

    def test_report_reference_reconciliation_detects_missing_timeline_facts(self) -> None:
        content = (
            "Restart approved by `approval:apv-001`. "
            "Execution evidence `timeline:42`, `tool:call-restart`, `artifact:art-001`, "
            "`finding:7`, `changeset:chg-001`."
        )
        timeline = [
            {"type": "tool_call", "seq": 42, "call_id": "call-restart"},
            {"type": "tool_result", "seq": 43, "call_id": "call-restart", "output": "artifact:art-001"},
        ]
        result = reconcile_report_with_timeline(
            content,
            timeline,
            known_findings={"7"},
            known_approvals={"apv-001"},
            known_changesets={"chg-001"},
        )
        self.assertTrue(result.ok)
        self.assertEqual(6, len(result.references))

        broken = reconcile_report_with_timeline("Missing reference `timeline:99`.", timeline)
        self.assertFalse(broken.ok)
        self.assertEqual(("timeline", "99"), (broken.missing[0].kind, broken.missing[0].identifier))

    def test_report_reference_extraction_is_stable_and_deduplicated(self) -> None:
        references = extract_report_references("See `timeline:1`, `timeline:1`, `tool:abc-123`.")
        self.assertEqual(
            [("timeline", "1"), ("tool", "abc-123")],
            [(item.kind, item.identifier) for item in references],
        )

    def test_release_docs_and_manifest_cover_d_group_quality_gate(self) -> None:
        manifest = json.loads((FIXTURES / "release_manifest_required.json").read_text(encoding="utf-8"))
        for relative_path in manifest["required_docs"]:
            self.assertTrue((ROOT / relative_path).is_file(), relative_path)
        self.assertIn("ZJ-<version>-SBOM.spdx.json", manifest["required_artifacts"])
        self.assertIn("report_timeline_mismatch", manifest["release_blockers"])

        checklist = (ROOT / "docs" / "release-checklist.md").read_text(encoding="utf-8")
        for phrase in (
            "CI 不依赖真实模型",
            "报告与 Timeline 对账通过",
            "P0/P1 安全问题清零",
            "干净 Windows VM",
        ):
            self.assertIn(phrase, checklist)


async def _get_response(model: ScriptedMockModel):
    return await model.get_response(
        system_instructions="system",
        input="user",
        model_settings=ModelSettings(),
        tools=[],
        output_schema=None,
        handoffs=[],
        tracing=None,
        previous_response_id=None,
        conversation_id=None,
        prompt=None,
    )


async def _stream_events(model: ScriptedMockModel):
    return [
        event
        async for event in model.stream_response(
            system_instructions="system",
            input="user",
            model_settings=ModelSettings(),
            tools=[],
            output_schema=None,
            handoffs=[],
            tracing=None,
            previous_response_id=None,
            conversation_id=None,
            prompt=None,
        )
    ]


if __name__ == "__main__":
    unittest.main()
