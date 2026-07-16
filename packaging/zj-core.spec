from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules, copy_metadata


root = Path(SPECPATH).resolve().parent
lightrag_datas, lightrag_binaries, lightrag_hiddenimports = collect_all("lightrag")
agents_datas, agents_binaries, agents_hiddenimports = collect_all("agents")
tiktoken_datas, tiktoken_binaries, tiktoken_hiddenimports = collect_all("tiktoken")

datas = [
    (str(root / ".z3r0" / "agents"), ".z3r0/agents"),
    (str(root / ".z3r0" / "config.json.example"), ".z3r0"),
    (str(root / "skills"), "skills"),
    (str(root / ".zj" / "tools"), "portable-tools"),
    (str(root / "web" / "dist-app"), "web/dist-app"),
    *copy_metadata("openai"),
    *lightrag_datas,
    *agents_datas,
    *tiktoken_datas,
]
hiddenimports = [
    *lightrag_hiddenimports,
    *agents_hiddenimports,
    *tiktoken_hiddenimports,
    *collect_submodules("tiktoken_ext"),
    *collect_submodules("agents"),
    *collect_submodules("sqlalchemy.dialects.sqlite"),
    *collect_submodules("uvicorn"),
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
    a.binaries,
    a.datas,
    [],
    name="zj-core",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
)
