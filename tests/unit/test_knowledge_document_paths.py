from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from lightrag.pipeline import _PipelineMixin

from core.lightrag.runtime import _configure_lightrag_input_dir


class _ParserSourceResolver:
    workspace = "zj"
    _resolve_source_file_for_parser = _PipelineMixin._resolve_source_file_for_parser


class KnowledgeDocumentPathTests(unittest.TestCase):
    def test_default_input_dir_is_exported_for_lightrag_parser(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            default_dir = Path(directory) / "lightrag" / "inputs"
            with patch.dict(os.environ, {"INPUT_DIR": ""}):
                resolved = _configure_lightrag_input_dir(default_dir)

                self.assertEqual(default_dir.resolve(), resolved)
                self.assertEqual(str(default_dir.resolve()), os.environ["INPUT_DIR"])

    def test_configured_input_dir_is_normalized_and_preserved(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            configured_dir = Path(directory) / "custom-inputs"
            unused_default = Path(directory) / "default-inputs"
            with patch.dict(os.environ, {"INPUT_DIR": str(configured_dir)}):
                resolved = _configure_lightrag_input_dir(unused_default)

                self.assertEqual(configured_dir.resolve(), resolved)
                self.assertEqual(str(configured_dir.resolve()), os.environ["INPUT_DIR"])

    def test_parser_resolves_file_written_to_workspace_input_dir(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            input_dir = Path(directory) / "inputs"
            source = input_dir / "zj" / "example.pdf"
            source.parent.mkdir(parents=True)
            source.write_bytes(b"%PDF-test")

            with patch.dict(os.environ, {"INPUT_DIR": ""}):
                _configure_lightrag_input_dir(input_dir)
                resolved = _ParserSourceResolver()._resolve_source_file_for_parser(
                    source.name,
                    source_file=source.name,
                    parser_engine="legacy",
                )

            self.assertEqual(source.resolve(), Path(resolved).resolve())


if __name__ == "__main__":
    unittest.main()
