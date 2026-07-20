import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from fastapi import HTTPException

from config import LightRAGConfig
from core.lightrag.runtime import _configured_openai_complete, _configured_openai_embed
from service.system_config.config import fetch_provider_models
from tests.unit._network_addresses import LOOPBACK_HOST


class _ModelHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        self.server.authorization = self.headers.get("Authorization")  # type: ignore[attr-defined]
        payload = b'{"data":[{"id":"z-model"},{"id":"a-model"},{"id":"a-model"}]}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args: object) -> None:
        return


class ProviderModelTests(unittest.IsolatedAsyncioTestCase):
    def test_provider_urls_are_blank_by_default(self) -> None:
        config = LightRAGConfig()

        self.assertEqual("", config.embedding_api)
        self.assertEqual("", config.llm_api)

    async def test_lightrag_requires_explicit_provider_urls(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "LightRAG 抽取模型"):
            await _configured_openai_complete("prompt")
        with self.assertRaisesRegex(RuntimeError, "LightRAG 嵌入模型"):
            await _configured_openai_embed(["text"])

    async def test_fetches_sorts_and_deduplicates_models(self) -> None:
        server = ThreadingHTTPServer((LOOPBACK_HOST, 0), _ModelHandler)
        server.authorization = None  # type: ignore[attr-defined]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = server.server_address
            models = await fetch_provider_models(f"http://{host}:{port}/v1", "test-provider-key")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

        self.assertEqual(["a-model", "z-model"], models)
        self.assertEqual("Bearer test-provider-key", server.authorization)  # type: ignore[attr-defined]

    async def test_rejects_non_http_provider_url(self) -> None:
        with self.assertRaises(HTTPException) as context:
            await fetch_provider_models("file:///tmp/models", "")

        self.assertEqual(400, context.exception.status_code)


if __name__ == "__main__":
    unittest.main()
