from __future__ import annotations

import uvicorn

from skill_hub.app import create_skill_hub_app
from skill_hub.config import get_skill_hub_settings


def main() -> None:
    settings = get_skill_hub_settings()
    uvicorn.run(
        create_skill_hub_app(),
        host=settings.bind_host,
        port=settings.bind_port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
