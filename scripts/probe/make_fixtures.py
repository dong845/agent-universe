#!/usr/bin/env python3
"""Pick typical local sessions and write structure-preserving, text-free copies to fixtures/.

Every string is replaced by a placeholder unless its key is on a short allowlist of
structural fields (record types, tool names, models, ids, timestamps). Paths and cwd
values become stable hashes, so project grouping still works. Numbers and booleans
are kept: they carry the token counts the adapters must reproduce.

Usage: python3 make_fixtures.py --out fixtures [--list]
"""
import argparse
import glob
import hashlib
import json
import os
import re
import shutil

KEEP = {
    "type", "subtype", "name", "model", "role", "status", "trigger", "agentType", "agentId",
    "id", "uuid", "parentUuid", "logicalParentUuid", "sessionId", "session_id", "requestId",
    "tool_use_id", "toolUseId", "toolUseID", "sourceToolUseID", "sourceToolAssistantUUID",
    "promptId", "timestamp", "version", "cli_version", "stop_reason", "level", "operation",
    "call_id", "turn_id", "root_turn_id", "thread_id", "parent_thread_id", "forked_from_id",
    "response_id", "model_provider", "originator", "effort", "permissionMode", "startTime",
    "requestShape", "spawnDepth", "isSidechain", "isMeta", "isCompactSummary", "is_error",
    "mode", "kind", "event", "source", "approval_policy", "collaboration_mode",
}
HASH = {"cwd", "workdir", "path", "file_path", "filePath", "notebook_path", "relocatedCwd",
        "worktreePath", "trackingPath", "outputFile"}

SAFE_KEY = re.compile(r"[A-Za-z_][A-Za-z0-9_-]{0,63}")


def h(s):
    return "h:" + hashlib.sha256(s.encode()).hexdigest()[:12]


def scrub(o, key=None):
    if isinstance(o, dict):
        # Keys can be data too (file-history snapshots and Codex patches are keyed by path).
        return {(k if SAFE_KEY.fullmatch(k) else h(k)): scrub(v, k) for k, v in o.items()}
    if isinstance(o, list):
        return [scrub(v, key) for v in o]
    if isinstance(o, str):
        if key in KEEP:
            return o
        if key in HASH:
            return h(o)
        return f"<{len(o)}>"
    return o


def scrub_file(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    n = 0
    with open(src, encoding="utf-8", errors="replace") as fi, open(dst, "w") as fo:
        for line in fi:
            if not line.strip():
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                fo.write('"<unparseable line>"\n')
                continue
            fo.write(json.dumps(scrub(d), ensure_ascii=False) + "\n")
            n += 1
    return n


def claude_candidates():
    out = []
    for m in glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl")):
        subs = glob.glob(m[:-6] + "/subagents/**/agent-*.jsonl", recursive=True)
        txt = open(m, encoding="utf-8", errors="replace").read()
        out.append({
            "path": m, "subs": subs, "mb": round(os.path.getsize(m) / 1e6, 1),
            "compact": txt.count('"compact_boundary"'), "errors": txt.count('"is_error":true'),
            "workflows": sum("/workflows/" in s for s in subs),
        })
    return sorted(out, key=lambda c: c["mb"])


def codex_candidates():
    out = []
    for f in glob.glob(os.path.expanduser("~/.codex/sessions/**/rollout-*.jsonl"), recursive=True):
        txt = open(f, encoding="utf-8", errors="replace").read()
        first = json.loads(txt.split("\n", 1)[0])["payload"]
        out.append({
            "path": f, "kb": os.path.getsize(f) // 1000, "version": first.get("cli_version"),
            "child": bool(first.get("parent_thread_id")), "spawn": txt.count('"spawn_agent"'),
            "compact": txt.count('"context_compacted"'), "aborted": txt.count('"turn_aborted"'),
            "usage_record": txt.count('"token_usage_record"'), "id": first.get("id"),
        })
    return out


def pick_codex(cands):
    """Smallest file for each feature the adapter must handle."""
    picks = {}
    by_size = sorted(cands, key=lambda c: c["kb"])
    for label, test in [
        ("spawns-subagent", lambda c: c["spawn"] > 0),
        ("compaction", lambda c: c["compact"] > 0),
        ("aborted-turn", lambda c: c["aborted"] > 0),
        ("token-usage-record", lambda c: c["usage_record"] > 0),
        ("plain", lambda c: not (c["spawn"] or c["compact"] or c["aborted"] or c["child"])),
    ]:
        c = next((c for c in by_size if test(c) and c["path"] not in [p["path"] for p in picks.values()]), None)
        if c:
            picks[label] = c
    # A spawning parent together with its child rollouts, so the link can be tested.
    by_id = {c["id"]: c for c in cands}
    families = {}
    for c in cands:
        if c["child"]:
            pid = json.loads(open(c["path"]).readline())["payload"].get("parent_thread_id")
            if pid in by_id:
                families.setdefault(pid, []).append(c)
    if families:
        pid = min(families, key=lambda i: by_id[i]["kb"] + sum(k["kb"] for k in families[i]))
        picks["spawns-subagent"] = by_id[pid]
        picks.update({f"spawns-subagent-child-{i}": k for i, k in enumerate(families[pid][:3])})
    return picks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="fixtures")
    ap.add_argument("--list", action="store_true", help="only print the candidates")
    a = ap.parse_args()
    cc = claude_candidates()
    xc = pick_codex(codex_candidates())
    print("claude sessions (smallest first):")
    for c in cc:
        print(f"  {os.path.basename(c['path'])[:8]}  {c['mb']:6.1f} MB  subs={len(c['subs'])} "
              f"workflow-agents={c['workflows']} compactions={c['compact']} tool-errors={c['errors']}")
    print("codex picks:")
    for k, c in xc.items():
        print(f"  {k:20s} {os.path.basename(c['path'])[:40]} {c['kb']} kB v{c['version']}")
    if a.list:
        return
    if os.path.isdir(a.out):
        shutil.rmtree(a.out)
    # Claude: the smallest session that has subagents, compaction and tool errors, plus the smallest overall.
    rich = next((c for c in cc if c["subs"] and c["compact"] and c["errors"]), None)
    plain = next((c for c in cc if not c["subs"] and c["compact"]), None)
    for label, c in (("subagents", rich), ("no-subagents", plain)):
        if not c:
            continue
        sid = os.path.basename(c["path"])[:-6]
        base = os.path.join(a.out, "claude-code", f"{label}-{sid[:8]}")
        n = scrub_file(c["path"], os.path.join(base, f"{sid}.jsonl"))
        for s in c["subs"]:
            rel = os.path.relpath(s, c["path"][:-6])
            n += scrub_file(s, os.path.join(base, sid, rel))
            meta = s[:-6] + ".meta.json"
            if os.path.exists(meta):
                dst = os.path.join(base, sid, rel[:-6] + ".meta.json")
                json.dump(scrub(json.load(open(meta))), open(dst, "w"))
        print(f"wrote claude-code/{label}-{sid[:8]}: {n} lines, {len(c['subs'])} subagent files")
    for label, c in xc.items():
        dst = os.path.join(a.out, "codex", label, os.path.basename(c["path"]))
        print(f"wrote codex/{label}: {scrub_file(c['path'], dst)} lines")


if __name__ == "__main__":
    main()
