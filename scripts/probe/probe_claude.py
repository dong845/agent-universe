#!/usr/bin/env python3
"""Phase-0 probe: answer the Claude Code log-format questions from real local logs.

Prints only aggregates (counts, field names, token sums) -- never message text.
Usage: python3 probe_claude.py [~/.claude/projects]
"""
import collections
import glob
import json
import os
import sys

ARGS = [a for a in sys.argv[1:] if not a.startswith("--json=")]
JSON_OUT = next((a[7:] for a in sys.argv[1:] if a.startswith("--json=")), None)
ROOT = os.path.expanduser(ARGS[0] if ARGS else "~/.claude/projects")
USAGE_KEYS = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")


def records(path, stats):
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if not line.strip():
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                stats["bad_lines"] += 1


def usage_tuple(u):
    return tuple(int(u.get(k) or 0) for k in USAGE_KEYS)


def session_tokens(paths, stats, dup):
    """Sum usage per file, both naively (every line) and deduped by message.id."""
    naive = [0] * 4
    dedup = {}
    for p in paths:
        for d in records(p, stats):
            if d.get("type") != "assistant":
                continue
            msg = d.get("message") or {}
            u = msg.get("usage")
            if not u:
                continue
            t = usage_tuple(u)
            naive = [a + b for a, b in zip(naive, t)]
            mid = msg.get("id") or d.get("uuid")
            if mid in dedup:
                dup["lines_sharing_id"] += 1
                dup["same_usage" if dedup[mid] == t else "different_usage"] += 1
                # keep the largest output: later lines may carry the final count
                if t[1] > dedup[mid][1]:
                    dedup[mid] = t
            else:
                dedup[mid] = t
    total = [sum(x[i] for x in dedup.values()) for i in range(4)]
    return naive, total, len(dedup)


def main():
    stats = collections.Counter()
    dup = collections.Counter()
    mains = sorted(glob.glob(f"{ROOT}/*/*.jsonl"))
    print(f"root: {ROOT}\nmain session files: {len(mains)}")

    sidechain_in_main = 0
    spawn_names = collections.Counter()
    result_shapes = collections.Counter()
    result_status = collections.Counter()
    result_has_tokens = 0
    linked = unlinked = 0
    meta_depth = collections.Counter()
    parallel_turns = 0
    compact = collections.Counter()
    recon = []
    session_totals = {}

    for m in mains:
        sid = os.path.basename(m)[:-6]
        sdir = os.path.join(os.path.dirname(m), sid, "subagents")
        subs = glob.glob(f"{sdir}/**/agent-*.jsonl", recursive=True)
        spawn_ids = set()
        cost_state = None
        for d in records(m, stats):
            if d.get("isSidechain"):
                sidechain_in_main += 1
            t = d.get("type")
            if t == "assistant":
                calls = [c for c in (d.get("message") or {}).get("content") or []
                         if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("name") in ("Agent", "Task")]
                for c in calls:
                    spawn_names[c["name"]] += 1
                    spawn_ids.add(c["id"])
                if len(calls) > 1:
                    parallel_turns += 1
            elif t == "user" and isinstance(d.get("toolUseResult"), dict) and "agentId" in d["toolUseResult"]:
                r = d["toolUseResult"]
                result_shapes[tuple(sorted(r))] += 1
                result_status[r.get("status")] += 1
                if any(k in r for k in ("totalTokens", "usage", "totalDurationMs")):
                    result_has_tokens += 1
            elif t == "system" and d.get("subtype") == "compact_boundary":
                compact[(d.get("compactMetadata") or {}).get("trigger")] += 1
            elif t == "user" and d.get("isCompactSummary"):
                compact["summary_message"] += 1
            elif t == "cost-state":
                cost_state = d  # keep the last one: it is a running snapshot
        for s in subs:
            meta_path = s[:-6] + ".meta.json"
            if os.path.exists(meta_path):
                meta = json.load(open(meta_path))
                meta_depth[meta.get("spawnDepth")] += 1
                if meta.get("toolUseId") in spawn_ids:
                    linked += 1
                else:
                    unlinked += 1
            else:
                unlinked += 1
        naive_main, ded_main, n_main = session_tokens([m], stats, dup)
        naive_sub, ded_sub, n_sub = session_tokens(subs, stats, dup)
        # usage tuple order is (input, output, cacheRead, cacheWrite) -- the adapter's order too
        session_totals[sid] = [a + b for a, b in zip(ded_main, ded_sub)]
        if cost_state:
            mu = cost_state.get("modelUsage") or {}
            off = [sum(int(v.get(k) or 0) for v in mu.values())
                   for k in ("inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens")]
            recon.append((sid[:8], len(subs), ded_main, ded_sub, naive_main, off))

    print("\nQ1 where subagent records live")
    print(f"  isSidechain lines inside main files: {sidechain_in_main}")
    print(f"  subagent files under <sid>/subagents/ (incl. workflows/): "
          f"{len(glob.glob(f'{ROOT}/*/*/subagents/**/agent-*.jsonl', recursive=True))}")
    print("\nQ2 linking a subagent to its spawning call")
    print(f"  spawn tool names: {dict(spawn_names)}")
    print(f"  meta.json toolUseId matches a spawn call in the parent: {linked}, not matched: {unlinked}")
    print(f"  spawnDepth: {dict(meta_depth)}   turns spawning >1 agent at once: {parallel_turns}")
    print("\nQ3 does the spawn result carry token/time totals")
    for k, v in result_shapes.most_common():
        print(f"  {v:5d}  {k}")
    print(f"  status values: {dict(result_status)}   results with token fields: {result_has_tokens}")
    print("\nQ4 usage repeated across lines of one message")
    print(f"  {dict(dup)}")
    print("  reconciliation vs the session's last cost-state (official running total):")
    print("  sid       subs | dedup main+sub (in,out,cacheR,cacheW) | naive main | cost-state")
    for sid, ns, dm, ds, nm, off in recon:
        both = [a + b for a, b in zip(dm, ds)]
        print(f"  {sid} {ns:4d} | {both} | {nm} | {off}")
    print("\nQ6 compaction")
    print(f"  {dict(compact)}")
    print(f"\nbad lines: {stats['bad_lines']}")
    if JSON_OUT:
        json.dump({"faction": "claude", "totals": session_totals}, open(JSON_OUT, "w"))


if __name__ == "__main__":
    main()
