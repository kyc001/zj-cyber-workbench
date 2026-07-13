import os
from ipaddress import ip_address
from multiprocessing import freeze_support


def main() -> None:
    import uvicorn

    from app import create_app
    from config import WORKSPACE, get_config, load_config
    from logger import setup_logging

    load_config()
    setup_logging(level="INFO", file_path=WORKSPACE / "app.log")
    cfg = get_config()
    application = create_app()
    host = os.environ.get("ZJ_BIND_HOST", cfg.system.listen_addr)
    if not ip_address(host).is_loopback:
        raise RuntimeError("portable ZJ only binds to a loopback address")
    uvicorn.run(
        application,
        host=host,
        port=int(os.environ.get("ZJ_BIND_PORT", cfg.system.listen_port)),
        log_config=None,
        access_log=False,
    )


if __name__ == "__main__":
    freeze_support()
    main()
