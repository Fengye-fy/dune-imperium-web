"""Download the 2020 base-game artwork into the existing local static pipeline.

Run from any directory: python board-games/tools/import-dune-assets.py
Requires requests and Pillow. No game server, frontend, or room data is touched.
Existing content-addressed images are reused; --refresh re-reads the public index.
"""
import argparse
import concurrent.futures
import hashlib
import io
import json
import os
from pathlib import Path
import re
import time

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "apps/site/public/board-games/assets/dune-imperium"
CATALOG = ROOT / "board-games/games/dune-imperium/catalog-base.json"
ORIGIN = "https://dunecardshub.com"
RESERVE = {"arrakis-liaison": 8, "the-spice-must-flow": 10, "foldspace": 6}
STARTER_COPIES = {"convincing-argument": 2, "dagger": 2, "dune-desert-planet": 2}
# The public index undercounts these four cards (63 instead of 67). Keep the
# correction explicit; never let a remote catalogue silently define deck rules.
COPY_CORRECTIONS = {"arrakis-recruiter": 2, "bene-gesserit-sister": 3,
                    "spice-hunter": 2, "worm-riders": 2}
COPY_SOURCE = "https://github.com/Chatanga/DuneImmorality/blob/master/scripts/modules/Deck.lua"
TITLE_CORRECTIONS = {"intrigue-corner-the-market": "Corner the Market", **{
    f"conflict-skirmish-{n}": f"Skirmish (variant {n})" for n in range(1, 5)}}


def get(url):
    if not url.startswith(ORIGIN + "/"):
        raise ValueError("Unexpected source host")
    for attempt in range(3):
        try:
            response = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=40)
            response.raise_for_status()
            return response.content
        except requests.RequestException:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def source_index():
    html = get(ORIGIN + "/").decode("utf-8")
    for match in re.finditer(r"self\.__next_f\.push\((.*?)\)</script>", html):
        value = json.loads(match.group(1))
        if len(value) < 2 or not isinstance(value[1], str) or '"initialCards":' not in value[1]:
            continue
        raw = value[1].split('"initialCards":', 1)[1]
        cards, _ = json.JSONDecoder().raw_decode(raw)
        result = []
        for card in cards:
            if card["expansionName"] != "Dune: Imperium":
                continue
            short = card["slug"].removeprefix("dune-imperium-")
            short = {"dune-the-desert-planet": "dune-desert-planet",
                     "corner-the-marker": "corner-the-market",
                     "smuggler-s-thopter": "smugglers-thopter"}.get(short, short)
            category = card["type"]
            if category == "other":
                category = "reserve" if short in RESERVE else "starter"
            if category == "conflict" and short.startswith("skirmish-"):
                short = "skirmish-" + str(len(short.split("-")[-1]))
            prefix = {"intrigue": "intrigue-", "conflict": "conflict-",
                      "leader": "leader-", "location": "space-"}.get(category, "")
            card_id = prefix + short
            if not re.fullmatch(r"[a-z0-9-]+", card_id):
                raise ValueError("Unexpected card ID: " + card_id)
            url = card["image"].replace("/thumbnails/", "/images/")
            copies = card["physicalCopies"]
            if category == "reserve":
                copies = RESERVE[short]
            elif category == "starter":
                copies = STARTER_COPIES.get(short, 1)  # per player, not per box
            result.append({"id": card_id, "englishName": card["title"], "category": category,
                           "copies": copies, "sourceUrl": f"{ORIGIN}/cards/{card['id']}/{card['slug']}",
                           "imageUrl": url})
        counts = {kind: sum(c["category"] == kind for c in result) for kind in
                  ["imperium", "intrigue", "conflict", "leader", "starter", "reserve", "location"]}
        expected = dict(zip(counts, [43, 34, 18, 8, 7, 3, 22]))
        if counts != expected or len(result) != sum(expected.values()) or len({c["id"] for c in result}) != len(result):
            raise ValueError(f"Source inventory changed; review before importing: {counts}")
        return result
    raise ValueError("No public card index found; existing assets were not changed")


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def manifest_revision(images):
    # Include expansion and decorative assets, even when only the base importer runs.
    raw = json.dumps(images, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return "assets-" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]


def download(card):
    record = dict(card)
    previous = record.get("image", {})
    cached = ASSETS / previous.get("src", "missing")
    if cached.is_file() and hashlib.sha256(cached.read_bytes()).hexdigest() == previous.get("sha256"):
        record["image"] = {**previous, "alt": record["englishName"]}
        return record
    data = get(card["imageUrl"])
    with Image.open(io.BytesIO(data)) as picture:
        picture.load()  # reject error pages and truncated images before publishing
        width, height = picture.size
        if picture.format != "WEBP" or not (32 <= width <= 8192 and 32 <= height <= 8192):
            raise ValueError("Unexpected image: " + card["id"])
    digest = hashlib.sha256(data).hexdigest()
    relative = f"cards/{card['category']}/{card['id']}.{digest[:12]}.webp"
    destination = ASSETS / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        temporary = destination.with_suffix(".tmp")
        temporary.write_bytes(data)
        os.replace(temporary, destination)
    record["image"] = {"src": relative, "width": width, "height": height,
                       "alt": card["englishName"], "placeholder": False,
                       "sha256": digest, "bytes": len(data), "sourceUrl": card["sourceUrl"]}
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Re-read the upstream public inventory")
    args = parser.parse_args()
    old = json.loads(CATALOG.read_text(encoding="utf-8")) if CATALOG.exists() else None
    cards = source_index() if args.refresh or old is None else old["entries"]
    for card in cards:
        if card["id"] in TITLE_CORRECTIONS:
            card.setdefault("sourceTitle", card["englishName"])
            card["englishName"] = TITLE_CORRECTIONS[card["id"]]
        if card["id"] in COPY_CORRECTIONS:
            card.setdefault("sourceCopies", card["copies"])
            card["copies"] = COPY_CORRECTIONS[card["id"]]
            card["copiesSource"] = COPY_SOURCE
    if old and args.refresh:
        previous = {c["id"]: c for c in old["entries"]}
        for card in cards:
            if card["id"] in previous and card["imageUrl"] == previous[card["id"]]["imageUrl"]:
                card["image"] = previous[card["id"]].get("image", {})
    # Fail before replacing either manifest if any download fails.
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        entries = sorted(pool.map(download, cards), key=lambda c: c["id"])
    revision = "base-2020-" + hashlib.sha256("".join(c["image"]["sha256"] for c in entries).encode()).hexdigest()[:12]
    catalog = {"schemaVersion": 1, "edition": "Dune: Imperium (2020)", "revision": revision,
               "source": ORIGIN + "/", "entries": entries}
    manifest = json.loads((ASSETS / "manifest.json").read_text(encoding="utf-8"))
    managed_ids = {c["id"] for c in entries}
    if old:
        managed_ids.update(c["id"] for c in old["entries"])
    # Preserve Claude's decorative ui:cover / zone:* entries and other manual assets.
    images = {key: value for key, value in manifest.get("images", {}).items() if key not in managed_ids}
    images.update({c["id"]: c["image"] for c in entries})
    manifest.update(revision=manifest_revision(images), baseRevision=revision, images=images)
    manifest["inventory"] = {kind: sum(c["category"] == kind for c in entries) for kind in
                             ["starter", "reserve", "imperium", "intrigue", "conflict", "leader", "location"]}
    manifest["attribution"] = {**manifest.get("attribution", {}), "host": ORIGIN, "edition": catalog["edition"],
                               "note": "English card faces hosted by Dune Cards Hub; original artwork belongs to its rights holders."}
    atomic_json(CATALOG, catalog)
    atomic_json(ASSETS / "manifest.json", manifest)
    print(json.dumps({"revision": revision, "images": len(entries),
                      "bytes": sum(c["image"]["bytes"] for c in entries), "inventory": manifest["inventory"]}))


if __name__ == "__main__":
    main()
