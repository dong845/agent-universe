import json
import os
import stat
import sys

import pytest
from conftest import ROOT
from prompts import PrivacyError
from run import NoImageTool, run

FAKE = r'''#!/usr/bin/env python3
import os, re, sys
sys.path.insert(0, os.environ["SYNTH_DIR"])
from synth import sprite
args = sys.argv[1:]
instr = args[-1]
cwd = args[args.index("-C") + 1]
with open(os.environ["FAKE_LOG"], "a") as f:
    f.write(instr.replace("\n", " ") + "\n")
mode = os.environ.get("FAKE_MODE", "ok")
fail = os.environ.get("FAKE_FAIL", "")
if mode == "limit":
    print("ERROR: You've hit your usage limit. Try again later.", file=sys.stderr)
    sys.exit(1)
if mode == "none" or (fail and fail in instr):
    sys.exit(0)
name = re.search(r"\./([\w.-]+\.png)", instr).group(1)
sprite().save(os.path.join(cwd, name))
'''

CAT = {
    "style": "S.", "view": "V.", "background": "Background: magenta, no text.",
    "factions": {"claude-code": "red.", "codex": "blue."},
    "themes": {"t": {"name": "T", "town": "A town.", "landmarks": [{"idea": "a tower"}], "houses": {"code": ["a hut", "a shed"]}}},
    "shared": {"public": {}, "misc": {}, "props": {}},
}


@pytest.fixture
def env(tmp_path, monkeypatch):
    bindir = tmp_path / "bin"
    bindir.mkdir()
    codex = bindir / "codex"
    codex.write_text(FAKE)
    codex.chmod(codex.stat().st_mode | stat.S_IEXEC)
    log = tmp_path / "calls.log"
    monkeypatch.setenv("FAKE_LOG", str(log))
    monkeypatch.setenv("SYNTH_DIR", str(ROOT / "tests" / "art"))
    dirs = {k: tmp_path / k for k in ("raw", "out", "sessions")}
    for d in dirs.values():
        d.mkdir()
    kw = dict(cat=CAT, themes=["t"], shared=False, raw_dir=dirs["raw"], out_dir=dirs["out"], manifest_path=tmp_path / "manifest.json",
              sheet_path=tmp_path / "sheet.png", forbidden=[], concurrency=2, codex=str(codex), sessions_dir=dirs["sessions"], log=lambda *a: None)
    calls = lambda: len(log.read_text().splitlines()) if log.exists() else 0
    return kw, calls, tmp_path


def test_a_batch_makes_every_item_and_a_contact_sheet(env):
    kw, calls, tmp = env
    rep = run(**kw)
    m = json.loads((tmp / "manifest.json").read_text())
    assert rep["made"] == 5 and rep["failed"] == []
    assert len(m) == 5 and (tmp / "sheet.png").exists()
    assert (tmp / "out" / "t" / "house_code_a.webp").exists()


def test_an_item_that_never_comes_back_is_reported_after_two_rerolls(env, monkeypatch):
    kw, calls, tmp = env
    monkeypatch.setenv("FAKE_FAIL", "a shed")
    rep = run(**kw)
    assert [f[0] for f in rep["failed"]] == ["t/house_code_b"]
    assert rep["made"] == 4
    shed_calls = [l for l in (tmp / "calls.log").read_text().splitlines() if "a shed" in l]
    assert len(shed_calls) == 3
    assert "t/house_code_b" not in json.loads((tmp / "manifest.json").read_text())


def test_no_image_tool_stops_before_the_batch(env, monkeypatch):
    kw, calls, tmp = env
    monkeypatch.setenv("FAKE_MODE", "none")
    with pytest.raises(NoImageTool):
        run(**kw)
    assert calls() == 1


def test_a_second_run_makes_nothing_and_redo_remakes_one(env):
    kw, calls, tmp = env
    run(**kw)
    n = calls()
    assert run(**kw)["made"] == 0 and calls() == n
    rep = run(**kw, redo="t/house_code_a")
    assert rep["made"] == 1 and calls() == n + 1


def test_a_local_name_in_a_prompt_stops_everything(env):
    kw, calls, tmp = env
    cat = json.loads(json.dumps(CAT))
    cat["themes"]["t"]["landmarks"][0]["idea"] = "a tower for my-secret-repo"
    with pytest.raises(PrivacyError):
        run(**{**kw, "cat": cat, "forbidden": ["my-secret-repo", "tower"]})
    assert calls() == 0


def test_codex_own_error_is_the_reason_given(env, monkeypatch):
    kw, calls, tmp = env
    monkeypatch.setenv("FAKE_MODE", "limit")
    with pytest.raises(NoImageTool, match="usage limit"):
        run(**kw)


def test_interim_art_is_imported_and_later_replaced(env):
    from import_raw import import_dir
    from synth import sprite

    kw, calls, tmp = env
    src = tmp / "interim"
    src.mkdir()
    sprite().save(src / "hut.png")
    rep = import_dir(src, {"hut.png": "t/house_code_a"}, kw["out_dir"], kw["manifest_path"])
    m = json.loads((tmp / "manifest.json").read_text())
    assert rep == {"imported": ["t/house_code_a"], "failed": []}
    assert m["t/house_code_a"]["source"] == "interim" and m["t/house_code_a"]["promptHash"] == "interim"
    assert (tmp / "out" / "t" / "house_code_a.webp").exists()
    # a real batch later makes every item, the interim one included
    assert run(**kw)["made"] == 5


def test_interim_import_refuses_a_failing_image(env):
    from import_raw import import_dir
    from PIL import Image

    kw, calls, tmp = env
    src = tmp / "interim"
    src.mkdir()
    Image.new("RGB", (300, 300), (255, 0, 255)).save(src / "blank.png")
    rep = import_dir(src, {"blank.png": "t/house_code_a", "missing.png": "t/house_code_b"}, kw["out_dir"], kw["manifest_path"])
    assert rep["imported"] == [] and [f[0] for f in rep["failed"]] == ["t/house_code_a", "t/house_code_b"]
