"""Import official expansion card faces into the local static asset pipeline.

Run: python board-games/tools/import-dune-expansion-assets.py [--refresh]
Does not start a server, run tests, or enable unimplemented game content.
"""
import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("base_assets", Path(__file__).with_name("import-dune-assets.py"))
base = importlib.util.module_from_spec(spec)
sys.dont_write_bytecode = True
spec.loader.exec_module(base)
CATALOG = base.ROOT / "board-games/games/dune-imperium/catalog-expansions.json"
SETS = {"Rise of Ix": ("rise-of-ix", "ix"), "Immortality": ("immortality", "imm")}
EXPECTED = {"rise-of-ix": {"imperium": 29, "intrigue": 17, "tech": 18, "leader": 6,
                            "conflict": 4, "location": 4, "variant": 1},
            "immortality": {"imperium": 25, "intrigue": 11, "tleilaxu": 19, "starter": 1}}


def source_index():
    html = base.get(base.ORIGIN + "/").decode("utf-8")
    for match in re.finditer(r"self\.__next_f\.push\((.*?)\)</script>", html):
        value = json.loads(match.group(1))
        if len(value) < 2 or not isinstance(value[1], str) or '"initialCards":' not in value[1]:
            continue
        cards, _ = json.JSONDecoder().raw_decode(value[1].split('"initialCards":', 1)[1])
        result = []
        for c in cards:
            if c["expansionName"] not in SETS:
                continue
            expansion, short_prefix = SETS[c["expansionName"]]
            short = c["slug"].removeprefix(expansion + "-")
            short = {"trade-monopoy": "trade-monopoly"}.get(short, short)
            category = c["type"]
            if category == "other":
                category = "starter" if short == "experimentation" else "variant"
            card_id = {
                "imperium": short_prefix + "-" + short,
                "intrigue": "intrigue-" + short_prefix + "-" + short,
                "tech": "tech-" + short,
                "leader": "leader-" + short,
                "conflict": "conflict-" + short_prefix + "-" + short,
                "location": "space-" + short,
                "tleilaxu": short if short == "reclaimed-forces" else "tleilaxu-" + short,
                "starter": short,
                "variant": short_prefix + "-" + short,
            }[category]
            if not re.fullmatch(r"[a-z0-9-]+", card_id):
                raise ValueError("Invalid source ID: " + card_id)
            result.append({"id": card_id, "englishName": c["title"], "category": category,
                           "expansion": expansion, "copies": 2 if category == "starter" else c["physicalCopies"],
                           "fixed": short == "reclaimed-forces",
                           "sourceUrl": f"{base.ORIGIN}/cards/{c['id']}/{c['slug']}",
                           "imageUrl": c["image"].replace("/thumbnails/", "/images/")})
        for expansion, expected in EXPECTED.items():
            counts = {kind: sum(c["expansion"] == expansion and c["category"] == kind for c in result) for kind in expected}
            if counts != expected:
                raise ValueError(f"Review changed inventory before importing: {expansion} {counts}")
        for expansion, kind, expected in [("rise-of-ix", "imperium", 35), ("rise-of-ix", "intrigue", 17),
                                          ("immortality", "imperium", 30), ("immortality", "intrigue", 15)]:
            copies = sum(c["copies"] for c in result if c["expansion"] == expansion and c["category"] == kind)
            if copies != expected:
                raise ValueError(f"Review changed physical copies before importing: {expansion} {kind} {copies}")
        if len({c["id"] for c in result}) != len(result):
            raise ValueError("Duplicate expansion ID")
        return result
    raise ValueError("No public card index; manifests were not changed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    old = json.loads(CATALOG.read_text(encoding="utf-8")) if CATALOG.exists() else None
    cards = source_index() if args.refresh or not old else old["entries"]
    previous = {c["id"]: c for c in old["entries"]} if old else {}
    for c in cards:
        if c["id"] in previous and c["imageUrl"] == previous[c["id"]]["imageUrl"]:
            c["image"] = previous[c["id"]].get("image", {})
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        entries = sorted(pool.map(base.download, cards), key=lambda c: c["id"])
    revision = "expansions-" + hashlib.sha256("".join(c["image"]["sha256"] for c in entries).encode()).hexdigest()[:12]
    catalog = {"schemaVersion": 1, "revision": revision, "source": base.ORIGIN + "/", "entries": entries}
    manifest_path = base.ASSETS / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    # Re-read immediately before publishing so independent decorative UI assets survive.
    manifest["images"].update({c["id"]: c["image"] for c in entries})
    manifest["expansionInventory"] = {exp: {kind: sum(c["expansion"] == exp and c["category"] == kind for c in entries)
                                               for kind in kinds} for exp, kinds in EXPECTED.items()}
    manifest["expansionRevision"] = revision
    manifest["revision"] = base.manifest_revision(manifest["images"])
    manifest.setdefault("attribution", {})["editions"] = ["Dune: Imperium (2020)", "Rise of Ix", "Immortality"]
    base.atomic_json(CATALOG, catalog)
    base.atomic_json(manifest_path, manifest)
    print(json.dumps({"revision": revision, "images": len(entries), "bytes": sum(c["image"]["bytes"] for c in entries)}))


if __name__ == "__main__":
    main()
