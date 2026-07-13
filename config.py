import json
import os
import secrets
import sys
import tempfile
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field

ROOT_PATH = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


def _load_environment_files() -> None:
    candidates = [ROOT_PATH / ".env", Path.cwd() / ".env"]
    executable_dir = Path(sys.executable).resolve().parent
    candidates.append(executable_dir / ".env")
    portable_dir = os.environ.get("PORTABLE_EXECUTABLE_DIR", "").strip()
    if portable_dir:
        candidates.append(Path(portable_dir) / ".env")

    seen: set[Path] = set()
    for candidate in candidates:
        candidate = candidate.resolve()
        if candidate not in seen:
            seen.add(candidate)
            load_dotenv(candidate, override=False)


_load_environment_files()
BUNDLED_AGENT_DIR = ROOT_PATH / ".z3r0" / "agents"
BUNDLED_SKILLS_DIR = ROOT_PATH / "skills"
BUNDLED_TOOLS_DIR = ROOT_PATH / "portable-tools"
DEFAULT_CONFIG_FILE = ROOT_PATH / ".z3r0" / "config.json.example"
_data_dir = os.environ.get("ZJ_DATA_DIR", "").strip()
WORKSPACE = Path(_data_dir).expanduser().resolve() if _data_dir else ROOT_PATH / ".zj"
load_dotenv(WORKSPACE / ".env", override=False)
CONFIG_FILE = WORKSPACE / "config.json"


# strict type config base model
class StrictConfigModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


# system config
class SystemConfig(StrictConfigModel):
    listen_addr: str = Field(default="127.0.0.1")
    listen_port: int = Field(default=8000)
    encrypt_key: str = Field(default_factory=lambda: secrets.token_urlsafe(32), min_length=32)


# database config
class DatabaseConfig(StrictConfigModel):
    url: str = Field(default="")
    filename: str = Field(default="zj.sqlite3", min_length=1)
    busy_timeout_ms: int = Field(default=5000, ge=0)
    pool_pre_ping: bool = Field(default=True)


# agent config
class AgentConfig(StrictConfigModel):
    code: str = Field(default="")
    name: str = Field(default="")
    description: str = Field(default="")
    base_url: str = Field(default="")
    api_key: str = Field(default="")
    model: str = Field(default="")
    use_responses: bool = Field(default=False)
    context_window: int = Field(default=1000000, ge=0)


# per-process agent runtime pool tuning
class AgentPoolConfig(StrictConfigModel):
    max_size: int = Field(default=256, ge=1)
    ttl_seconds: int = Field(default=30 * 60, ge=0)
    sweep_interval_seconds: int = Field(default=60, ge=1)


# per-process agent run tuning
class AgentRuntimeConfig(StrictConfigModel):
    main_max_turns: int = Field(default=1000, ge=1)
    subordinate_max_turns: int = Field(default=1000, ge=1)
    model_stream_idle_timeout_seconds: int = Field(default=300, ge=30)
    report_retention_seconds: int = Field(default=3 * 24 * 60 * 60, ge=0)
    context_compression_enabled: bool = True
    context_compression_trigger_ratio: float = Field(default=0.90, gt=0, lt=1)
    context_compression_hard_stop_ratio: float = Field(default=0.98, gt=0, lt=1)
    context_compression_target_ratio: float = Field(default=0.20, gt=0, lt=1)
    context_budget_model_call_ratio: float = Field(default=0.80, gt=0, lt=1)
    context_compression_preserve_recent_ratio: float = Field(default=0.25, gt=0, lt=1)
    context_compression_preserve_recent_items: int = Field(default=20, ge=1)
    context_compression_min_items: int = Field(default=12, ge=1)
    context_compression_summary_max_tokens: int = Field(default=8000, ge=512)


# LightRAG config
class LightRAGConfig(StrictConfigModel):
    embedding_api: str = Field(default="https://api.openai.com/v1", min_length=1)
    embedding_key: str = Field(default="")
    embedding_model: str = Field(default="text-embedding-3-small", min_length=1)
    embedding_dim: int = Field(default=1536, ge=1)
    llm_api: str = Field(default="https://api.openai.com/v1", min_length=1)
    llm_key: str = Field(default="")
    llm_model: str = Field(default="gpt-5", min_length=1)
    graph_matches: int = Field(default=5, ge=1, le=50)
    chunk_matches: int = Field(default=10, ge=1, le=50)


# global config
class GlobalConfig(StrictConfigModel):
    system: SystemConfig = Field(default_factory=SystemConfig)
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    agents: dict[str, AgentConfig] = Field(default_factory=dict)
    agent_pool: AgentPoolConfig = Field(default_factory=AgentPoolConfig)
    agent_runtime: AgentRuntimeConfig = Field(default_factory=AgentRuntimeConfig)
    lightrag: LightRAGConfig = Field(default_factory=LightRAGConfig)


###
# global config instance
###
_cfg: GlobalConfig = GlobalConfig()


def load_config():
    """load config from json file"""
    global _cfg

    ensure_config_file()
    next_cfg = read_config_file()
    for field_name in type(_cfg).model_fields:
        setattr(_cfg, field_name, getattr(next_cfg, field_name))


def get_config():
    """get config instance"""
    global _cfg
    return _cfg


def read_config_file() -> GlobalConfig:
    """read and validate config.json without mutating global state"""
    with open(CONFIG_FILE, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) and isinstance(data.get("system"), dict):
        data["system"].pop("bootstrap_admin", None)
    cfg = GlobalConfig.model_validate(data)
    _apply_portable_branding(cfg)
    _apply_provider_environment(cfg)
    return cfg


def _apply_portable_branding(cfg: GlobalConfig) -> None:
    descriptions = {
        "cso": "首席安全协调 Agent，负责理解目标、编排专家、汇总结论与交付报告",
        "cae": "代码审计 Agent，负责源码、依赖、配置与安全编码检查",
        "cce": "密码与协议 Agent，负责密码学、协议与密钥管理分析",
        "cie": "情报侦察 Agent，负责授权范围内的资产发现与信息收集",
        "cpe": "安全测试 Agent，负责授权渗透测试与漏洞验证",
        "cre": "逆向分析 Agent，负责二进制、固件与文件分析",
    }
    legacy_descriptions = {
        "Chief Security Officer",
        "Chief Audit Engineer",
        "Chief Cryptography Engineer",
        "Chief Intelligence Engineer",
        "Chief Penetration Engineer",
        "Chief Reverse Engineer",
    }
    for code, agent in cfg.agents.items():
        if code == "cso" and agent.name.strip().lower() in {"z3r0", "zj"}:
            agent.name = "真君"
        if agent.description.strip() in legacy_descriptions and code in descriptions:
            agent.description = descriptions[code]


def _apply_provider_environment(cfg: GlobalConfig) -> None:
    base_url = os.environ.get("ZJ_OPENAI_BASE_URL", "").strip()
    api_key = os.environ.get("ZJ_OPENAI_API_KEY", "").strip()
    model = os.environ.get("ZJ_OPENAI_MODEL", "").strip()

    for agent in cfg.agents.values():
        if base_url:
            agent.base_url = base_url
        if api_key:
            agent.api_key = api_key
        if model:
            agent.model = model

    if base_url:
        cfg.lightrag.embedding_api = base_url
        cfg.lightrag.llm_api = base_url
    if api_key:
        cfg.lightrag.embedding_key = api_key
        cfg.lightrag.llm_key = api_key
    if model:
        cfg.lightrag.llm_model = model


def ensure_config_file() -> None:
    """Create a first-run config in the writable portable data directory."""
    if CONFIG_FILE.is_file():
        return

    if DEFAULT_CONFIG_FILE.is_file():
        with open(DEFAULT_CONFIG_FILE, encoding="utf-8") as f:
            cfg = GlobalConfig.model_validate(json.load(f))
    else:
        cfg = GlobalConfig()
    cfg.system.encrypt_key = secrets.token_urlsafe(32)
    write_config_file(cfg)


def write_config_file(cfg: GlobalConfig) -> None:
    """atomically write a validated config.json"""
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    data: dict[str, Any] = cfg.model_dump(mode="json")
    payload = json.dumps(data, ensure_ascii=False, indent=4)

    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=WORKSPACE,
            prefix=".config.",
            suffix=".json.tmp",
            delete=False,
        ) as f:
            temp_path = Path(f.name)
            f.write(payload)
            f.write("\n")
        temp_path.replace(CONFIG_FILE)
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
