#!/usr/bin/env python3
"""Local resource-only sticker audit. No network, packages, build, or JSX changes.

Default: read-only verification against manifest.json and the current catalogs.
--copy: copy missing public files without overwriting different target bytes,
        then write manifest.json, conflicts.json and validation-report.json.
--report FILE: save a read-only validation result to FILE.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
DEFAULT_TARGET = HERE.parent.parent
DEFAULT_SOURCE = DEFAULT_TARGET.parent / "51dianzi-platform"
PUBLIC_DIRS = ("chat-stickers", "chat-sticker-tabs")
IMAGE_EXTENSIONS = {".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif"}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def image_check(path: Path, data: bytes) -> dict:
    if not data:
        raise ValueError(f"empty file: {path}")
    if path.suffix.lower() not in IMAGE_EXTENSIONS:
        return {"type": "text", "nonempty": True}
    probe = data[:4096].lstrip(b"\xef\xbb\xbf \t\r\n").lower()
    if probe.startswith((b"<!doctype html", b"<html")) or b"<html" in probe:
        raise ValueError(f"HTML instead of image: {path}")
    ext = path.suffix.lower()
    if ext == ".svg":
        root = ET.fromstring(data)
        if root.tag.split("}")[-1] != "svg":
            raise ValueError(f"not an SVG document: {path}")
        if not any(e.tag.split("}")[-1] in {"path", "rect", "circle", "ellipse", "polygon", "polyline", "line", "image", "text", "use"} for e in root.iter()):
            raise ValueError(f"SVG contains no graphic element: {path}")
        return {"type": "svg", "xmlParsed": True}
    expected = {
        ".png": data.startswith(b"\x89PNG\r\n\x1a\n"),
        ".jpg": data.startswith(b"\xff\xd8\xff") and data.endswith(b"\xff\xd9"),
        ".jpeg": data.startswith(b"\xff\xd8\xff") and data.endswith(b"\xff\xd9"),
        ".webp": data.startswith(b"RIFF") and data[8:12] == b"WEBP" and len(data) >= 20,
        ".gif": data.startswith((b"GIF87a", b"GIF89a")),
    }
    if not expected.get(ext):
        raise ValueError(f"image signature mismatch: {path}")
    try:
        from PIL import Image
    except ImportError:
        return {"type": ext[1:], "signatureVerified": True, "decoded": False}
    with Image.open(io.BytesIO(data)) as image:
        image.verify()
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        width, height = image.size
        if width <= 0 or height <= 0:
            raise ValueError(f"invalid dimensions: {path}")
    return {"type": ext[1:], "signatureVerified": True, "decoded": True, "width": width, "height": height}


def catalog_refs(repo: Path, manager: bool) -> dict:
    asset_dir = repo / ("client/src/business/platform/client/src/assets/stickers" if manager else "client/src/assets/stickers")
    index_file, noto_file = asset_dir / "index.ts", asset_dir / "noto.ts"
    index, noto = index_file.read_text(), noto_file.read_text()
    imports = dict(re.findall(r'import\s+(\w+)\s+from\s+[\"\'](\./[^\"\']+\.(?:webp|png|jpg|svg))[\"\']', index))
    refs, packs = [], {}
    for pack, body in re.findall(r'export const (\w+_CHAT_STICKERS) = \[(.*?)\] as const;', index, re.S):
        objects = re.findall(r'\{(.*?)\}', body, re.S)
        packs[pack] = len(objects)
        for obj in objects:
            sid = re.search(r'\bid:\s*[\"\']([^\"\']+)[\"\']', obj).group(1)
            for role, field in (("src", "imageUrl"), ("thumb", "thumbnailUrl")):
                match = re.search(r'\b' + field + r':\s*(?:[\"\']([^\"\']+)[\"\']|(\w+))', obj)
                if match is None:
                    raise ValueError(f"unresolved {field}: {sid}")
                url, variable = match.groups()
                if url:
                    refs.append({"stickerId": sid, "pack": pack, "role": role, "resolution": "public", "url": url})
                elif variable in imports:
                    refs.append({"stickerId": sid, "pack": pack, "role": role, "resolution": "vite-module-import", "import": imports[variable], "filePath": str(asset_dir / imports[variable][2:])})
                else:
                    raise ValueError(f"unknown import {variable}: {sid}")
    noto_ids = re.findall(r'\[\s*[\"\'](noto-[^\"\']+)[\"\']\s*,', noto)
    if 'const imageUrl = `/chat-stickers/noto/${id}.svg`;' not in noto or 'thumbnailUrl: imageUrl' not in noto:
        raise ValueError("Noto path generator changed; update resource audit parser explicitly")
    packs["NOTO_CHAT_STICKERS"] = len(noto_ids)
    for sid in noto_ids:
        for role in ("src", "thumb"):
            refs.append({"stickerId": sid, "pack": "NOTO_CHAT_STICKERS", "role": role, "resolution": "public", "url": f"/chat-stickers/noto/{sid}.svg"})
    icons = dict(re.findall(r'export const (chat\w+Icon) = [\"\'](/chat-sticker[^\"\']+)[\"\'];', index))
    for name, url in icons.items():
        refs.append({"stickerId": name, "pack": "tabs", "role": "tab", "resolution": "public", "url": url})
    aliases = dict(re.findall(r'export const (chat\w+Icon) = (chat\w+Icon);', index))
    for name, other in aliases.items():
        if other not in icons:
            raise ValueError(f"unresolved icon alias: {name} -> {other}")
        refs.append({"stickerId": name, "pack": "tabs", "role": "picker-icon-alias", "resolution": "public", "url": icons[other]})
    return {"indexPath": str(index_file), "indexSha256": digest(index.encode()), "notoPath": str(noto_file), "notoSha256": digest(noto.encode()), "packs": packs, "references": refs}


def check_vite(repo: Path) -> dict:
    config_file = repo / "vite.config.ts"
    text = config_file.read_text()
    if not re.search(r'root:\s*path\.resolve\(import\.meta\.dirname,\s*[\"\']client[\"\']\)', text):
        raise ValueError("unexpected Vite root; inspect configuration before copying")
    if not re.search(r'publicDir:\s*path\.resolve\(import\.meta\.dirname,\s*[\"\']client[\"\'],\s*[\"\']public[\"\']\)', text):
        raise ValueError("unexpected Vite publicDir; inspect configuration before copying")
    return {"configPath": str(config_file), "root": str(repo / "client"), "publicRoot": str(repo / "client/public"), "confirmedBy": "explicit root/publicDir in vite.config.ts"}


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def copy_resources(source: Path, target: Path, manifest_file: Path) -> dict:
    source_vite, target_vite = check_vite(source), check_vite(target)
    source_catalog, target_catalog = catalog_refs(source, False), catalog_refs(target, True)
    source_public, target_public = source / "client/public", target / "client/public"
    source_files = sorted(p for name in PUBLIC_DIRS for p in (source_public / name).rglob("*") if p.is_file())
    total_bytes = sum(p.stat().st_size for p in source_files)
    if total_bytes >= 20_000_000:
        raise ValueError("source public trees exceed 20 MB; refuse full-directory copy")
    entries, conflicts = [], []
    public_refs = target_catalog["references"]
    for source_file in source_files:
        if source_file.is_symlink():
            raise ValueError(f"source symlink not allowed: {source_file}")
        relative = source_file.relative_to(source_public).as_posix()
        target_file = target_public / relative
        data = source_file.read_bytes()
        image_info = image_check(source_file, data)
        sha = digest(data)
        target_file.parent.mkdir(parents=True, exist_ok=True)
        # Exclusive creation guarantees that a concurrently-added target is never overwritten.
        try:
            with target_file.open("xb") as output:
                output.write(data)
            status = "copied"
        except FileExistsError:
            if target_file.is_symlink() or not target_file.is_file():
                raise ValueError(f"unsafe existing target: {target_file}")
            target_data = target_file.read_bytes()
            status = "already-identical" if digest(target_data) == sha else "conflict-preserved"
            if status == "conflict-preserved":
                conflicts.append({"sourcePath": str(source_file), "targetRelative": relative, "url": "/" + relative, "sourceBytes": len(data), "sourceSha256": sha, "targetBytes": len(target_data), "targetSha256": digest(target_data), "action": "existing target preserved; no overwrite"})
        uses = [ref for ref in public_refs if ref.get("url") == "/" + relative]
        entries.append({"sourcePath": str(source_file), "targetRelative": relative, "url": "/" + relative, "bytes": len(data), "sha256": sha, "copyStatus": status, "roles": sorted(set(ref["role"] for ref in uses)), "catalogReferences": uses, "imageValidation": image_info, "retention": "catalog-reference" if uses else ("license-notice" if source_file.name in ("NOTICE.md", "LICENSE-APACHE-2.0.txt") else "retained-complete-source-directory")})
    bundled = []
    for file_path in sorted(set(r["filePath"] for r in target_catalog["references"] if r["resolution"] == "vite-module-import")):
        target_file = Path(file_path)
        source_file = source / "client/src/assets/stickers" / target_file.name
        data = source_file.read_bytes()
        bundled.append({"sourcePath": str(source_file), "targetPath": str(target_file), "bytes": len(data), "sha256": digest(data), "resolution": "vite-module-import", "url": None, "note": "Already present in manager source assets; Vite generates deployment URL. Not a fixed public file and not modified by this task.", "imageValidation": image_check(source_file, data)})
    manifest = {"schemaVersion": 1, "generatedAt": datetime.now(timezone.utc).isoformat(), "scope": "resource-only, existing local assets; no network/build/JSX modifications", "sourceVite": source_vite, "targetVite": target_vite, "preserveCompleteDirectories": True, "publicDirectories": list(PUBLIC_DIRS), "sourceCatalog": source_catalog, "targetCatalog": target_catalog, "resources": entries, "bundledModuleAssets": bundled, "conflicts": conflicts, "summary": {"publicFiles": len(entries), "publicBytes": total_bytes, "copied": sum(e["copyStatus"] == "copied" for e in entries), "alreadyIdentical": sum(e["copyStatus"] == "already-identical" for e in entries), "conflicts": len(conflicts), "bundledModuleFiles": len(bundled), "bundledModuleBytes": sum(e["bytes"] for e in bundled)}}
    write_json(manifest_file, manifest)
    write_json(manifest_file.parent / "conflicts.json", conflicts)
    return manifest


def verify(manifest: dict, target: Path) -> dict:
    errors, missing, mismatches, invalid = [], [], [], []
    public_root = target / "client/public"
    vite = check_vite(target)
    catalog = catalog_refs(target, True)
    manifest_rows = {r["targetRelative"]: r for r in manifest["resources"]}
    public_bytes = 0
    decoded, svg_parsed = 0, 0
    for relative, row in manifest_rows.items():
        path = public_root / relative
        if not path.is_file():
            missing.append("/" + relative)
            continue
        if path.is_symlink():
            invalid.append({"path": str(path), "error": "target symlink not allowed"})
            continue
        data = path.read_bytes()
        public_bytes += len(data)
        if len(data) != row["bytes"] or digest(data) != row["sha256"]:
            mismatches.append("/" + relative)
        try:
            info = image_check(path, data)
            decoded += int(info.get("decoded", False))
            svg_parsed += int(info.get("xmlParsed", False))
        except Exception as exc:
            invalid.append({"path": str(path), "error": str(exc)})
    reference_coverage = Counter()
    for ref in catalog["references"]:
        reference_coverage[ref["role"]] += 1
        if ref["resolution"] == "public":
            relative = ref["url"].lstrip("/")
            if relative not in manifest_rows:
                errors.append(f"catalog public reference absent from manifest: {ref['url']}")
            if not (public_root / relative).is_file() and ref["url"] not in missing:
                missing.append(ref["url"])
    current_modules = {r["filePath"] for r in catalog["references"] if r["resolution"] == "vite-module-import"}
    recorded_modules = {r["targetPath"] for r in manifest["bundledModuleAssets"]}
    if current_modules != recorded_modules:
        errors.append("bundled module reference set differs from manifest")
    for row in manifest["bundledModuleAssets"]:
        path = target / Path(row["targetPath"]).relative_to(Path(manifest["targetVite"]["root"]).parent)
        if not path.is_file():
            missing.append(str(path))
            continue
        data = path.read_bytes()
        if len(data) != row["bytes"] or digest(data) != row["sha256"]:
            mismatches.append(str(path))
        try:
            image_check(path, data)
        except Exception as exc:
            invalid.append({"path": str(path), "error": str(exc)})
    present_files = {p.relative_to(public_root).as_posix() for name in PUBLIC_DIRS for p in (public_root / name).rglob("*") if p.is_file()}
    if {"chat-stickers/noto/LICENSE-APACHE-2.0.txt", "chat-stickers/noto/NOTICE.md"} - set(manifest_rows):
        errors.append("Noto license/notice absent from manifest")
    expected_packs = {"NOTO_CHAT_STICKERS": 96, "EMOJI_CHAT_STICKERS": 32, "YAYATUAN_CHAT_STICKERS": 12, "BUSINESS_CHAT_STICKERS": 16}
    if catalog["packs"] != expected_packs:
        errors.append(f"catalog pack counts changed: {catalog['packs']}")
    directory_summary = {}
    for row in manifest["resources"]:
        directory = str(Path(row["targetRelative"]).parent)
        item = directory_summary.setdefault(directory, {"files": 0, "bytes": 0, "catalogReferencedFiles": 0})
        item["files"] += 1
        item["bytes"] += row["bytes"]
        item["catalogReferencedFiles"] += bool(row["catalogReferences"])
    result = {"ok": not (errors or missing or mismatches or invalid or manifest["conflicts"]), "publicRoot": vite["publicRoot"], "publicFiles": len(manifest_rows), "publicBytes": public_bytes, "missing": len(missing), "missingResources": missing, "hashMismatchCount": len(mismatches), "hashMismatches": mismatches, "invalidFileCount": len(invalid), "invalidFiles": invalid, "conflictCount": len(manifest["conflicts"]), "errors": errors, "catalogPacks": catalog["packs"], "catalogStickerCount": sum(catalog["packs"].values()), "referenceCoverage": dict(reference_coverage), "uniquePublicCatalogUrls": len({r["url"] for r in catalog["references"] if r["resolution"] == "public"}), "bundledModuleFiles": len(recorded_modules), "bundledModuleBytes": sum(r["bytes"] for r in manifest["bundledModuleAssets"]), "rasterPublicFilesDecoded": decoded, "svgPublicFilesXmlParsed": svg_parsed, "unmanifestedTargetFiles": sorted(present_files - set(manifest_rows)), "directories": directory_summary, "note": "Local files only; no assertions about live online availability or Vite-generated hashed import URLs."}
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--target", type=Path, default=DEFAULT_TARGET)
    parser.add_argument("--manifest", type=Path, default=HERE / "manifest.json")
    parser.add_argument("--copy", action="store_true", help="copy missing public resources only; never overwrite differing bytes")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        manifest = copy_resources(args.source.resolve(), args.target.resolve(), args.manifest) if args.copy else json.loads(args.manifest.read_text())
        result = verify(manifest, args.target.resolve())
        if args.copy or args.report:
            write_json(args.report or args.manifest.parent / "validation-report.json", result)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["ok"] else 1
    except Exception as exc:
        print(f"RESOURCE AUDIT FAILED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
