#!/usr/bin/env python3
"""Phase-0 probe: answer the Codex log-format questions from real local rollouts.

Prints only aggregates (counts, field names, token sums) -- never message text.
Usage: python3 probe_codex.py [~/.codex/sessions]
"""
import collections
import glob
import json
import os
import sys

ARGS = [a for a in sys.argv[1:] if not a.startswith("--json=")]
JSON_OUT = next((a[7:] for a in sys.argv[1:] if a.startswith("--json=")), None)
ROOT = os.path.expanduser(ARGS[0] if ARGS else "~/.codex/sessions")
TOK = ("input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens")


def main():
    files = sorted(glob.glob(f"{ROOT}/**/rollout-*.jsonl", recursive=True))
    print(f"root: {ROOT}\nrollout files: {len(files)}  ({os.path.basename(files[0])[8:18]} .. {os.path.basename(files[-1])[8:18]})")
    kinds = collections.Counter()
    info_keys = collections.Counter()
    tool_names = collections.Counter()
    versions = collections.Counter()
    bad = 0
    cumulative_ok = cumulative_broken = 0
    last_sums_match = last_sums_off = 0
    null_info = 0
    turns_with_tokens = turns_without = 0
    compaction = collections.Counter()
    ctx_window = collections.Counter()
    subagent_hint = collections.Counter()
    file_totals = {}

    for f in files:
        prev_total = None
        sum_last = [0] * len(TOK)
        final_total = None
        in_turn = False
        turn_has_tok = False
        for line in open(f, encoding="utf-8", errors="replace"):
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                bad += 1
                continue
            t = d.get("type")
            p = d.get("payload") if isinstance(d.get("payload"), dict) else {}
            pt = p.get("type")
            kinds[(t, pt)] += 1
            if t == "session_meta":
                versions[p.get("cli_version")] += 1
                for k in ("source", "originator", "forked_from_id", "parent_thread_id"):
                    if p.get(k) not in (None, "", "cli", "codex_cli_rs", "exec"):
                        subagent_hint[(k, str(p.get(k))[:20] if k == "source" else "set")] += 1
            if t == "compacted" or pt in ("context_compacted", "compaction"):
                compaction[(t, pt)] += 1
            if t == "response_item" and pt in ("function_call", "custom_tool_call", "local_shell_call", "web_search_call"):
                tool_names[p.get("name") or pt] += 1
            if t == "event_msg" and pt == "task_started":
                in_turn, turn_has_tok = True, False
            if t == "event_msg" and pt == "task_complete":
                turns_with_tokens += turn_has_tok
                turns_without += not turn_has_tok
                in_turn = False
            if t == "event_msg" and pt == "token_count":
                info = p.get("info")
                if not info:
                    null_info += 1
                    continue
                turn_has_tok = True
                info_keys[tuple(sorted(info))] += 1
                ctx_window[info.get("model_context_window")] += 1
                tot = info.get("total_token_usage") or {}
                last = info.get("last_token_usage") or {}
                cur = tuple(int(tot.get(k) or 0) for k in TOK)
                if prev_total is not None and cur != prev_total:
                    if all(a >= b for a, b in zip(cur, prev_total)):
                        cumulative_ok += 1
                    else:
                        cumulative_broken += 1
                if cur != prev_total:  # repeated identical snapshots are not new calls
                    sum_last = [a + int(last.get(k) or 0) for a, k in zip(sum_last, TOK)]
                prev_total = cur
                final_total = cur
        # unified order (input without cache, output, cacheRead, cacheWrite); zeros when no usage
        ft = final_total or (0,) * len(TOK)
        file_totals[os.path.basename(f)] = [ft[0] - ft[1], ft[2], ft[1], 0]
        if final_total:
            if list(final_total) == sum_last:
                last_sums_match += 1
            else:
                last_sums_off += 1

    print(f"cli versions: {dict(versions.most_common(5))}")
    print("\nrecord kinds:")
    for k, v in kinds.most_common(30):
        print(f"  {v:7d}  {k}")
    print("\nQ5 token_count semantics")
    print(f"  info key sets: {dict(info_keys)}")
    print(f"  token_count with info=null: {null_info}")
    print(f"  total_token_usage monotonic between changes: ok={cumulative_ok} broken={cumulative_broken}")
    print(f"  files where sum(last_token_usage over changes) == final total: {last_sums_match}, differ: {last_sums_off}")
    print(f"  model_context_window values: {dict(ctx_window.most_common(5))}")
    print(f"  turns (task_started..task_complete) with a token_count: {turns_with_tokens}, without: {turns_without}")
    print("\nQ6 compaction records:", dict(compaction))
    print("\ntool call names:", dict(tool_names.most_common(15)))
    print("subagent / fork hints in session_meta:", dict(subagent_hint))
    print(f"bad lines: {bad}")
    if JSON_OUT:
        json.dump({"faction": "codex", "totals": file_totals}, open(JSON_OUT, "w"))


if __name__ == "__main__":
    main()
