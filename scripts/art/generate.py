"""One image from Codex's hosted image tool, through `codex exec` on the user's subscription (no API
key). The run happens in its own empty folder; the image is the PNG Codex writes there, or else the
last image_generation_call in the rollout of that very run (matched by its working folder)."""
import base64
import io
import json
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from PIL import Image

INSTR = (
    "Generate ONE image using your hosted image_generation tool (it is NOT a local model and NOT PIL). Pass the EXACT "
    "text between the <IMAGE_PROMPT> markers to the tool as the image prompt, VERBATIM: do not paraphrase, shorten or "
    "add to it.\n<IMAGE_PROMPT>\n{prompt}\n</IMAGE_PROMPT>\n\n"
    "It MUST be a generated illustration: do NOT draw it with code and do NOT search for local model files. The tool's "
    "base64 result appears in your session rollout JSONL as an 'image_generation_call' payload; decode it and write the "
    "raw bytes to ./{fname} in the current working directory, then run `ls -l ./{fname}`. Reply only 'OK' when the file "
    "exists, or 'TOOL_RETURNS_NO_FILE' if the tool returns nothing."
)


def _valid(path):
    try:
        with Image.open(path) as im:
            im.load()
            return im.size[0] >= 256 and im.size[1] >= 256
    except Exception:
        return False


def _from_rollout(sessions_dir, since, workdir, out):
    """the last image of the rollout this run created (its session_meta cwd is our folder)"""
    if not sessions_dir or not Path(sessions_dir).exists():
        return False
    for f in sorted(Path(sessions_dir).rglob("rollout-*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True):
        if f.stat().st_mtime < since:
            break
        b64, mine = None, False
        with open(f, encoding="utf-8", errors="replace") as fh:
            for i, line in enumerate(fh):
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                p = rec.get("payload") or {}
                if i == 0 and rec.get("type") == "session_meta":
                    mine = Path(p.get("cwd", "")).resolve() == Path(workdir).resolve()
                    if not mine:
                        break
                if rec.get("type") == "response_item" and p.get("type") == "image_generation_call" and isinstance(p.get("result"), str):
                    b64 = p["result"]
        if mine and b64:
            out.write_bytes(base64.b64decode(b64))
            return _valid(out)
    return False


LAST_ERROR = {}


def codex_error(stderr):
    """Codex's own "ERROR: …" line (usage limit, login, plan), if it printed one"""
    lines = [l.strip() for l in (stderr or "").splitlines() if l.strip().startswith("ERROR:")]
    return lines[-1][len("ERROR:"):].strip() if lines else None


def generate(item, raw_dir, codex="codex", timeout=600, sessions_dir=None, log=print):
    """→ the raw PNG path, or None (the reason is logged and kept in LAST_ERROR[item id])"""
    theme, name = item["id"].split("/", 1)
    out = Path(raw_dir) / theme / f"{name}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    fname = f"{name}.png"
    cmd = [codex, "exec", "--skip-git-repo-check", "--sandbox", "workspace-write", "-c", 'approval_policy="never"', "-C", "", INSTR.format(prompt=item["prompt"], fname=fname)]
    since = time.time() - 1
    LAST_ERROR.pop(item["id"], None)
    work = Path(tempfile.mkdtemp(prefix="agent-town-art-"))
    cmd[cmd.index("-C") + 1] = str(work)
    try:
        r = subprocess.run(cmd, cwd=work, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, timeout=timeout)
        err = codex_error(r.stderr)
        if err:
            LAST_ERROR[item["id"]] = err
            log(f"  {item['id']}: codex says: {err}")
    except subprocess.TimeoutExpired:
        log(f"  {item['id']}: codex timed out after {timeout}s")
    except OSError as e:
        log(f"  {item['id']}: codex could not start: {e}")
        shutil.rmtree(work, ignore_errors=True)
        return None
    try:
        made = work / fname
        if _valid(made):
            shutil.move(str(made), out)
            return out
        if _from_rollout(sessions_dir, since, work, out):
            return out
        log(f"  {item['id']}: codex returned no image")
        return None
    finally:
        shutil.rmtree(work, ignore_errors=True)
