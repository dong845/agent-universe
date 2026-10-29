"""Art catalogue → generation items (spec v3 7.1). A prompt carries a theme and a building only: it
never names a project, a path or a conversation, and check_private refuses one that does."""
import re

CATEGORIES = ("landmark", "house", "public", "misc", "prop")


class PrivacyError(ValueError):
    pass


def _catalogue_words(cat):
    text = " ".join(str(v) for v in _walk(cat))
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def _walk(x):
    if isinstance(x, dict):
        for v in x.values():
            yield from _walk(v)
    elif isinstance(x, list):
        for v in x:
            yield from _walk(v)
    else:
        yield x


def check_private(prompt, forbidden, known_words=frozenset()):
    """raise PrivacyError when a local name (≥ 4 chars) is in the prompt; only short plain words the
    catalogue itself uses are exempt"""
    low = prompt.lower()
    for name in forbidden:
        n = name.strip().lower()
        if len(n) < 4:
            continue
        # a short plain word the catalogue itself uses ("music", "town") is generic; a compound or
        # longer name ("slides_maker", "agent-town") is someone's project and is never allowed
        if n in known_words and n.isalpha() and len(n) <= 6:
            continue
        if n in low:
            raise PrivacyError(f"prompt would carry a local name ({len(n)} chars)")


def build_prompt(cat, desc, context=""):
    parts = [desc, context, cat["style"], cat["view"], cat["background"]]
    return " ".join(p.strip() for p in parts if p and p.strip())


def items(cat, themes, shared, forbidden=()):
    """every generation item for the given themes (and the shared set), with its full prompt"""
    out = []
    known = _catalogue_words(cat)
    for t in themes:
        if t not in cat["themes"]:
            raise KeyError(f"unknown theme: {t}")
        th = cat["themes"][t]
        grow = {1: "The small early version: modest size, one storey, a little unfinished.",
                2: "The full building at its normal size.",
                3: "The grand expanded version: bigger, with annexes, a tower and festive banners."}
        for i, lm in enumerate(th["landmarks"], 1):
            for tier in (1, 2, 3):
                desc = f"A single landmark building: {lm['idea']}. {grow[tier]}"
                out.append({"id": f"{t}/landmark_{i}_t{tier}", "theme": t, "category": "landmark", "prompt": build_prompt(cat, desc, th["town"])})
        for kind, variants in th["houses"].items():
            for v, d in zip("ab", variants):
                out.append({"id": f"{t}/house_{kind}_{v}", "theme": t, "category": "house", "prompt": build_prompt(cat, f"A single small house: {d}", th["town"])})
    if shared:
        sh = cat["shared"]
        for k, d in sh["public"].items():
            for f, line in cat["factions"].items():
                out.append({"id": f"shared/public_{k}_{f}", "theme": "shared", "category": "public", "prompt": build_prompt(cat, d, f"It belongs to a cozy medieval town. {line}")})
        for k, d in sh["misc"].items():
            out.append({"id": f"shared/misc_{k}", "theme": "shared", "category": "misc", "prompt": build_prompt(cat, d)})
        for k, d in sh["props"].items():
            out.append({"id": f"shared/prop_{k}", "theme": "shared", "category": "prop", "prompt": build_prompt(cat, d)})
    for it in out:
        check_private(it["prompt"], forbidden, known)
    return out
