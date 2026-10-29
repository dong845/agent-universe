"""Art batch (spec v3 7): catalogue → Codex images → cut-out → checks (≤ 2 rerolls) → WebP + manifest →
contact sheet. Usage: node --run art -- --themes publishing,film,craftsmen --shared [--only GLOB] [--redo GLOB]"""
import argparse
import concurrent.futures as cf
import fnmatch
import json
import sys
import urllib.request
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cutout import CutoutError, cutout  # noqa: E402
from generate import generate  # noqa: E402
from pack import pack, write_manifest  # noqa: E402
from prompts import items as make_items  # noqa: E402
from qa import qa  # noqa: E402
from sheet import make_sheet  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


class NoImageTool(RuntimeError):
    pass


def _process(item, raw_dir, out_dir, codex, sessions_dir, log, tries):
    reasons, raw = [], None
    for attempt in range(tries):
        raw = generate(item, raw_dir, codex=codex, sessions_dir=sessions_dir, log=log)
        if raw is None:
            reasons = ["no image"]
            continue
        try:
            rgba = cutout(Image.open(raw))
        except CutoutError as e:
            reasons = [f"cutout: {e}"]
            continue
        reasons = qa(rgba, item["category"])
        if reasons:
            log(f"  {item['id']}: try {attempt + 1} failed checks: {', '.join(reasons)}")
            continue
        try:
            return pack(rgba, item, out_dir), [], raw
        except ValueError as e:
            reasons = [str(e)]
    return None, reasons, raw


def run(cat, themes, shared, raw_dir, out_dir, manifest_path, sheet_path, forbidden, concurrency=3, rerolls=2,
        only=None, redo=None, codex="codex", sessions_dir=None, log=print):
    its = make_items(cat, themes, shared, forbidden)  # PrivacyError before anything is sent
    if only:
        its = [i for i in its if fnmatch.fnmatch(i["id"], only)]
    manifest = json.loads(Path(manifest_path).read_text()) if Path(manifest_path).exists() else {}
    from pack import hashlib  # same hash as pack()

    def done(i):
        e = manifest.get(i["id"])
        theme, name = i["id"].split("/", 1)
        return e and e["promptHash"] == hashlib.sha256(i["prompt"].encode()).hexdigest()[:16] and (Path(out_dir) / theme / f"{name}.webp").exists()

    todo = [i for i in its if (redo and fnmatch.fnmatch(i["id"], redo)) or not done(i)]
    report = {"made": 0, "skipped": len(its) - len(todo), "failed": []}
    if not todo:
        return report
    log(f"{len(todo)} to make, {report['skipped']} already made")
    # preflight: one image must come back before a batch is started
    first = todo[0]
    raw = generate(first, raw_dir, codex=codex, sessions_dir=sessions_dir, log=log)
    if raw is None:
        raise NoImageTool("Codex returned no image for the first item: check `codex login` and that this account's plan has the image tool. No paid API is used instead.")
    results = {}

    def finish(item, pre_raw=None):
        if pre_raw is not None:
            try:
                rgba = cutout(Image.open(pre_raw))
                problems = qa(rgba, item["category"])
                if not problems:
                    return pack(rgba, item, out_dir), [], pre_raw
                log(f"  {item['id']}: try 1 failed checks: {', '.join(problems)}")
            except (CutoutError, ValueError) as e:
                log(f"  {item['id']}: try 1: {e}")
            return _process(item, raw_dir, out_dir, codex, sessions_dir, log, rerolls)
        return _process(item, raw_dir, out_dir, codex, sessions_dir, log, rerolls + 1)

    with cf.ThreadPoolExecutor(max_workers=max(1, concurrency)) as ex:
        futs = {ex.submit(finish, first, raw): first}
        futs.update({ex.submit(finish, i): i for i in todo[1:]})
        for fut in cf.as_completed(futs):
            item = futs[fut]
            entry, reasons, last_raw = fut.result()
            results[item["id"]] = (entry, reasons, last_raw)
            log(f"  {'ok ' if entry else 'FAIL'} {item['id']}{'' if entry else ' — ' + ', '.join(reasons)}")
    made, failed = [], []
    for item in todo:
        entry, reasons, last_raw = results[item["id"]]
        theme, name = item["id"].split("/", 1)
        if entry:
            manifest[item["id"]] = entry
            made.append((item["id"], Path(out_dir) / theme / f"{name}.webp"))
        else:
            failed.append((item["id"], reasons, last_raw))
    write_manifest(manifest, manifest_path)
    make_sheet(made, failed, sheet_path)
    report["made"] = len(made)
    report["failed"] = [(i, r) for i, r, _ in failed]
    return report


def _town_names(url="http://127.0.0.1:5182/api/world"):
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            w = json.load(r)
        return sorted({t["name"] for t in w.get("towns", [])} | {t["projectId"].rstrip("/").split("/")[-1] for t in w.get("towns", [])})
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--themes", default="")
    ap.add_argument("--shared", action="store_true")
    ap.add_argument("--only")
    ap.add_argument("--redo")
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--batch", default="批次")
    ap.add_argument("--allow-no-server", action="store_true", help="run without the local town names to check against")
    a = ap.parse_args()
    names = _town_names()
    if names is None and not a.allow_no_server:
        print("The local server (node --run start) is not up, so prompts cannot be checked against your town names. Start it, or pass --allow-no-server.", file=sys.stderr)
        return 2
    cat = json.loads((ROOT / "art" / "catalog.json").read_text())
    home = Path.home()
    try:
        rep = run(cat, [t for t in a.themes.split(",") if t], a.shared, home / ".agent-town" / "art-src", ROOT / "packages" / "web" / "public" / "art",
                  ROOT / "art" / "manifest.json", home / "Desktop" / "agent-town-美术" / f"{a.batch}.png", names or [], concurrency=a.concurrency,
                  only=a.only, redo=a.redo, sessions_dir=home / ".codex" / "sessions")
    except NoImageTool as e:
        print(f"停止：{e}", file=sys.stderr)
        return 3
    print(json.dumps(rep, ensure_ascii=False))
    return 0 if not rep["failed"] else 1


if __name__ == "__main__":
    sys.exit(main())
