import os
from pathlib import Path

from PyInstaller.utils.hooks import (
    collect_all,
    collect_data_files,
    collect_dynamic_libs,
    collect_submodules,
    copy_metadata,
)


root = Path(SPECPATH).resolve().parent
portable_tools_dir = Path(
    os.environ.get("ZJ_PORTABLE_TOOLS_DIR", root / "build" / "windows-tools")
).resolve()


def _collect_lightrag():
    """Collect lightrag datas, binaries, and hiddenimports.

    ``collect_all("lightrag")`` cannot be used because PyInstaller's isolated
    child process imports lightrag, which triggers ``parse_args()`` →
    ``sys.exit(2)`` when it sees PyInstaller's internal IPC arguments.
    ``SystemExit`` inherits from ``BaseException``, so PyInstaller's
    ``except Exception`` in ``_collect_submodules`` does not catch it.

    Instead we collect data files and binaries directly (no import required),
    and enumerate hidden imports from the filesystem.
    """
    # datas and binaries are safe — they don't import the package
    datas = list(collect_data_files("lightrag"))
    binaries = list(collect_dynamic_libs("lightrag"))

    # Walk the lightrag package tree to build hidden imports without importing
    import importlib.util as _util
    _spec = _util.find_spec("lightrag")
    if _spec is None or not _spec.submodule_search_locations:
        return datas, binaries, []
    _pkg_root = Path(_spec.submodule_search_locations[0])
    _parent = _pkg_root.parent
    hiddenimports: list[str] = []
    for _py in _pkg_root.rglob("*.py"):
        _rel = _py.relative_to(_parent)
        _mod = str(_rel.with_suffix("")).replace(os.sep, ".")
        if _mod.endswith(".__init__"):
            _mod = _mod[: -len(".__init__")]
        hiddenimports.append(_mod)
    hiddenimports.sort()
    return datas, binaries, hiddenimports


lightrag_datas, lightrag_binaries, lightrag_hiddenimports = _collect_lightrag()
agents_datas, agents_binaries, agents_hiddenimports = collect_all("agents")
tiktoken_datas, tiktoken_binaries, tiktoken_hiddenimports = collect_all("tiktoken")

datas = [
    (str(root / ".z3r0" / "agents"), ".z3r0/agents"),
    (str(root / ".z3r0" / "config.json.example"), ".z3r0"),
    (str(root / "skills"), "skills"),
    (str(root / "web" / "dist-app"), "web/dist-app"),
    *copy_metadata("openai"),
    *lightrag_datas,
    *agents_datas,
    *tiktoken_datas,
]
if portable_tools_dir.is_dir():
    datas.append((str(portable_tools_dir), "portable-tools"))
hiddenimports = [
    *lightrag_hiddenimports,
    *agents_hiddenimports,
    *tiktoken_hiddenimports,
    *collect_submodules("tiktoken_ext"),
    *collect_submodules("agents"),
    *collect_submodules("sqlalchemy.dialects.sqlite"),
    *collect_submodules("uvicorn"),
    # pywin32 namespace packages in non-standard subdirectories that
    # PyInstaller's static analysis may miss on Windows.
    "win32timezone",
]

a = Analysis(
    [str(root / "main.py")],
    pathex=[str(root)],
    binaries=[*lightrag_binaries, *agents_binaries, *tiktoken_binaries],
    datas=datas,
    hiddenimports=hiddenimports,
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    name="zj-core",
    exclude_binaries=True,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="zj-core",
)
