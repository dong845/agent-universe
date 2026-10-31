import json

import pytest
from conftest import ROOT
from prompts import PrivacyError, check_private, items

CAT = json.loads((ROOT / "art" / "catalog.json").read_text())
BATCH1 = ["publishing", "film", "craftsmen"]


def test_batch1_counts():
    its = items(CAT, BATCH1, shared=True)
    themed = [i for i in its if i["theme"] != "shared"]
    shared = [i for i in its if i["theme"] == "shared"]
    assert len(themed) == 3 * (6 * 3 + 6 * 2)
    assert len(shared) == 12 * 2 + 9 + 8
    assert len({i["id"] for i in its}) == len(its)


def test_every_prompt_carries_the_view_and_the_background():
    for i in items(CAT, BATCH1, shared=True):
        p = i["prompt"]
        assert CAT["view"] in p and CAT["background"] in p and "magenta" in p, i["id"]
        assert p.lower().count("text") == p.lower().count("no text"), i["id"]


def test_public_buildings_wear_their_faction():
    its = {i["id"]: i for i in items(CAT, [], shared=True)}
    assert CAT["factions"]["codex"] in its["shared/public_read_codex"]["prompt"]
    assert CAT["factions"]["claude-code"] in its["shared/public_read_claude-code"]["prompt"]


def test_landmark_tiers_grow_from_one_idea():
    its = {i["id"]: i for i in items(CAT, ["film"], shared=False)}
    idea = CAT["themes"]["film"]["landmarks"][1]["idea"]
    assert all(idea in its[f"film/landmark_2_t{t}"]["prompt"] for t in (1, 2, 3))


def test_check_private():
    with pytest.raises(PrivacyError):
        check_private("a cozy slides_maker print house", ["slides_maker"])
    check_private("a cozy music hall", ["music"], known_words={"music"})  # a catalogue word is not a secret
    check_private("a cozy hut", ["hut"])  # too short to mean anything
    with pytest.raises(PrivacyError):
        check_private("Agent-Town square", ["agent-town"])
    with pytest.raises(PrivacyError):  # even when the catalogue itself was edited to carry it
        check_private("the slides_maker hall", ["slides_maker"], known_words={"slides_maker"})


def test_unknown_theme_names_itself():
    with pytest.raises(KeyError, match="nope"):
        items(CAT, ["nope"], shared=False)


def test_prompts_keep_magenta_off_the_building():
    for i in items(CAT, BATCH1, shared=True):
        assert "uses no magenta" in i["prompt"], i["id"]
