#!/usr/bin/env python3
"""Fetch pinned CC0 source models and rebuild Taxi-LIB's local visual assets.

This is a maintainer tool, not part of the application build. The resulting GLBs
are committed under public/assets so running the game needs no external service.
Only Python's standard library is required.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import struct
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public" / "assets"
MIRROR_REPO = "mohammedemara48-code/police-command"
MIRROR_COMMIT = "db6a7ba31e4071db4aa7ec5d7ea0349d1343bd93"
SOURCES = {
    "civ_m1.glb": "bd3b28096e32c5b185dcaa5a48d1bd20a8b7a053e5bb46c81e74e72b97ca9a95",
    "civ_m2.glb": "40b7c0662298be2af41106eeb7deec92379e472cb16463459bed9dcf8c7b2aaa",
    "civ_f1.glb": "569d8cd5b5bccca18d371a4c97ac84c1d24970b9cae35fe878ff78c8e2aad262",
    "civ_f2.glb": "a975365e4fc121e408d0295a6456c39febb1131f8a1f563de106c1f5a5d48447",
    "car-sedan2.glb": "3065e6346a28bcff5ab15fec3fc04bfacda16ad79985eb83b1a1193fdf4ac822",
    "car-hatch.glb": "af91fbc8bf9f4e0830f85f488e523f297e6020968b635440c471a44c2020c423",
    "car-van.glb": "4e26fae6bb9a5a82d396db9cd0dedb53a1eba76bf4e9bad722712107a846cc16",
}

UPSTREAM = {
    "people": "https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html",
    "animation": "https://quaternius.itch.io/universal-animation-library",
    "sedan": "https://www.innerscene.com/tools/library/3d-parts/white-four-door-sedan-1f271353",
    "hatchback": "https://www.innerscene.com/tools/library/3d-parts/silver-five-door-compact-hatchback-6bf4a878",
    "minibus": "https://www.innerscene.com/tools/library/3d-parts/passenger-van-with-side-windows-474dd4a2",
}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(name: str) -> bytes:
    url = f"https://api.github.com/repos/{MIRROR_REPO}/contents/public/models/{name}?ref={MIRROR_COMMIT}"
    request = urllib.request.Request(url, headers={"Accept": "application/vnd.github.raw+json", "User-Agent": "Taxi-LIB-asset-preparer"})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def read_glb(data: bytes) -> tuple[dict, bytes]:
    magic, version, total = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2 or total != len(data):
        raise ValueError("Invalid GLB container")
    json_length, json_type = struct.unpack_from("<II", data, 12)
    if json_type != 0x4E4F534A:
        raise ValueError("GLB JSON chunk is missing")
    document = json.loads(data[20 : 20 + json_length])
    bin_header = 20 + json_length
    bin_length, bin_type = struct.unpack_from("<II", data, bin_header)
    if bin_type != 0x004E4942:
        raise ValueError("GLB BIN chunk is missing")
    binary = data[bin_header + 8 : bin_header + 8 + bin_length]
    return document, binary


def write_glb(document: dict, binary: bytes) -> bytes:
    encoded = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    binary += b"\0" * (-len(binary) % 4)
    total = 12 + 8 + len(encoded) + 8 + len(binary)
    return (
        struct.pack("<4sII", b"glTF", 2, total)
        + struct.pack("<II", len(encoded), 0x4E4F534A)
        + encoded
        + struct.pack("<II", len(binary), 0x004E4942)
        + binary
    )


def image_view(document: dict, image_index: int) -> int:
    return int(document["images"][image_index]["bufferView"])


def skin_image(document: dict) -> int:
    material = next(item for item in document["materials"] if item.get("name") == "Skin")
    texture_index = material["pbrMetallicRoughness"]["baseColorTexture"]["index"]
    texture = document["textures"][texture_index]
    source = texture.get("source", texture.get("extensions", {}).get("EXT_texture_webp", {}).get("source"))
    if source is None:
        raise ValueError("Skin texture has no supported image source")
    return int(source)


def view_bytes(document: dict, binary: bytes, view_index: int) -> bytes:
    view = document["bufferViews"][view_index]
    start = view.get("byteOffset", 0)
    return binary[start : start + view["byteLength"]]


def replace_skin(base: bytes, donor: bytes, donor_name: str) -> bytes:
    document, binary = read_glb(base)
    donor_document, donor_binary = read_glb(donor)
    image_index = skin_image(document)
    donor_image_index = skin_image(donor_document)
    target_view_index = image_view(document, image_index)
    donor_view_index = image_view(donor_document, donor_image_index)
    if any(accessor.get("bufferView") == target_view_index for accessor in document.get("accessors", [])):
        raise ValueError("Skin image unexpectedly shares a geometry bufferView")
    replacement = view_bytes(donor_document, donor_binary, donor_view_index)

    # Meshopt exports can contain a second, virtual buffer whose bufferViews do
    # not address the GLB BIN directly. Only physical buffer 0 is rebuilt; the
    # compressed source ranges that point into it must move by the same delta.
    target_view = document["bufferViews"][target_view_index]
    if target_view.get("buffer", 0) != 0:
        raise ValueError("Expected the skin image in physical buffer 0")
    old_start = target_view.get("byteOffset", 0)
    old_length = target_view["byteLength"]
    old_end = old_start + old_length
    delta = len(replacement) - old_length
    rebuilt = binary[:old_start] + replacement + binary[old_end:]
    for view in document["bufferViews"]:
        if view.get("buffer", 0) == 0:
            offset = view.get("byteOffset", 0)
            if offset > old_start:
                view["byteOffset"] = offset + delta
        compression = view.get("extensions", {}).get("EXT_meshopt_compression")
        if compression and compression.get("buffer", 0) == 0 and compression["byteOffset"] > old_start:
            compression["byteOffset"] += delta
    target_view["byteLength"] = len(replacement)
    document["buffers"][0]["byteLength"] = len(rebuilt)
    document["images"][image_index]["name"] = donor_name
    document["images"][image_index]["mimeType"] = donor_document["images"][donor_image_index]["mimeType"]
    document["asset"]["copyright"] = "MakeHuman Community and Quaternius; CC0 1.0"
    document["asset"]["generator"] = document["asset"].get("generator", "glTF") + " + Taxi-LIB skin variant"
    return write_glb(document, rebuilt)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, help="Use previously downloaded source GLBs instead of fetching them")
    args = parser.parse_args()
    source_dir = args.source_dir
    temporary = None
    if source_dir is None:
        temporary = tempfile.TemporaryDirectory(prefix="taxilib-visual-assets-")
        source_dir = Path(temporary.name)

    try:
        source: dict[str, bytes] = {}
        for name, expected in SOURCES.items():
            path = source_dir / name
            data = path.read_bytes() if path.exists() else fetch(name)
            if digest(data) != expected:
                raise ValueError(f"SHA-256 mismatch for reviewed source {name}: {digest(data)}")
            source[name] = data
            if not path.exists():
                path.write_bytes(data)

        outputs = {
            "characters/citizen-male.glb": replace_skin(source["civ_m1.glb"], source["civ_m2.glb"], "young_darkskinned_male_diffuse"),
            "characters/citizen-female.glb": replace_skin(source["civ_f1.glb"], source["civ_f2.glb"], "middleage_darkskinned_female_diffuse"),
            "vehicles/sedan.glb": source["car-sedan2.glb"],
            "vehicles/hatchback.glb": source["car-hatch.glb"],
            "vehicles/minibus.glb": source["car-van.glb"],
        }
        for relative, data in outputs.items():
            destination = PUBLIC / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            print(f"{relative}: {len(data):,} bytes, sha256 {digest(data)}")

        manifest = {
            "revision": 1,
            "license": "CC0-1.0",
            "mirror": {"repository": MIRROR_REPO, "commit": MIRROR_COMMIT},
            "sources": {name: {"path": f"public/models/{name}", "sha256": expected} for name, expected in SOURCES.items()},
            "upstream": UPSTREAM,
            "derivatives": {
                "characters/citizen-male.glb": "civ_m1 fully clothed male with the civ_m2 dark-skin texture",
                "characters/citizen-female.glb": "civ_f1 fully clothed female with the civ_f2 dark-skin texture",
                "vehicles/sedan.glb": "Innerscene white sedan; re-oriented, interiors removed, wheels regrouped, simplified and compressed by the pinned mirror",
                "vehicles/hatchback.glb": "Innerscene silver hatchback; re-oriented, interiors removed, wheels regrouped, simplified and compressed by the pinned mirror",
                "vehicles/minibus.glb": "Innerscene passenger van; re-oriented, interiors removed, wheels regrouped, simplified and compressed by the pinned mirror",
            },
            "outputs": {name: {"bytes": len(data), "sha256": digest(data)} for name, data in outputs.items()},
        }
        PUBLIC.mkdir(parents=True, exist_ok=True)
        (PUBLIC / "asset-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    finally:
        if temporary is not None:
            temporary.cleanup()


if __name__ == "__main__":
    main()
