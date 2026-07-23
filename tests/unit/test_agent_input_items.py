import unittest

from pydantic import TypeAdapter, ValidationError

from core.runtime.input_items import build_user_message_item, display_text_from_content, retrieval_text_from_content
from schema.agent.events import (
    AgentFileInputPart,
    AgentImageInputPart,
    AgentInputPart,
    AgentTextInputPart,
    validate_agent_input_content,
)


class AgentInputItemTests(unittest.TestCase):
    def test_file_part_round_trips_through_discriminated_union(self) -> None:
        adapter = TypeAdapter(AgentInputPart)

        part = adapter.validate_python({
            "type": "file",
            "name": "sample.log",
            "path": "/inbox/run-1/sample.log",
            "size": 42,
            "sha256": "A" * 64,
            "media_type": "text/plain",
        })

        self.assertIsInstance(part, AgentFileInputPart)
        self.assertEqual("a" * 64, part.sha256)

    def test_file_metadata_rejects_control_characters_and_relative_paths(self) -> None:
        with self.assertRaises(ValidationError):
            AgentFileInputPart(name="bad\nname", path="/inbox/file", size=1)
        with self.assertRaises(ValidationError):
            AgentFileInputPart(name="file", path="../outside", size=1)
        with self.assertRaises(ValidationError):
            AgentFileInputPart(name="file", path="/inbox/../outside", size=1)

    def test_model_input_exposes_workspace_reference_as_untrusted_data(self) -> None:
        part = AgentFileInputPart(
            name="evidence.zip",
            path="/inbox/demo/evidence.zip",
            size=2048,
            sha256="f" * 64,
            media_type="application/zip",
        )

        item = build_user_message_item([AgentTextInputPart(text="Inspect this"), part])
        content = item["content"]

        self.assertEqual("input_text", content[0]["type"])
        self.assertEqual("Inspect this", content[0]["text"])
        self.assertEqual("input_text", content[1]["type"])
        self.assertIn("/inbox/demo/evidence.zip", content[1]["text"])
        self.assertIn("untrusted data", content[1]["text"])
        self.assertNotIn("evidence.zip", retrieval_text_from_content([part]))

    def test_display_text_summarizes_non_text_attachments(self) -> None:
        image = AgentImageInputPart(media_type="image/png", data="aGVsbG8=")
        file = AgentFileInputPart(name="input.bin", path="/inbox/input.bin", size=5)

        self.assertEqual("[Image, File: input.bin]", display_text_from_content([image, file]))

    def test_file_only_display_text_includes_names_for_session_titles(self) -> None:
        files = [
            AgentFileInputPart(name="server.log", path="/inbox/server.log", size=10),
            AgentFileInputPart(name="config.yaml", path="/inbox/config.yaml", size=20),
            AgentFileInputPart(name="notes.txt", path="/inbox/notes.txt", size=30),
        ]

        self.assertEqual(
            "[Files: server.log, config.yaml +1]",
            display_text_from_content(files),
        )

    def test_message_accepts_at_most_eight_files(self) -> None:
        files = [
            AgentFileInputPart(name=f"{index}.txt", path=f"/inbox/{index}.txt", size=index)
            for index in range(9)
        ]

        with self.assertRaisesRegex(ValueError, "at most 8 files"):
            validate_agent_input_content(files)


if __name__ == "__main__":
    unittest.main()
