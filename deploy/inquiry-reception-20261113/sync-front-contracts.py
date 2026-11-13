#!/usr/bin/env python3
"""Sync the inquiry contract whitelist from real frontend sources, never fabricate types.

This type-only mirror is not loaded as a production server. Normalize both relative
imports and frontend @shared aliases into the isolated platform snapshot namespace.
"""
from pathlib import Path
import argparse
import os
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("--front", type=Path, required=True)
parser.add_argument("--admin", type=Path, required=True)
args = parser.parse_args()
front = args.front.resolve()
base = args.admin.resolve() / "client/src/business/platform"
paths = set(subprocess.check_output(["git", "diff", "--name-only"], cwd=front, text=True).splitlines()
    + subprocess.check_output(["git", "ls-files", "--others", "--exclude-standard"], cwd=front, text=True).splitlines())
# Unchanged real dependencies whose old type snapshots predate the source baseline.
paths.update([
    "server/services/supplierForumRecommendationModel.ts",
    "server/services/supplierForumRecommendationAllowlist.ts",
    "server/services/supplierForumTodayRecommendation.ts",
    "server/services/internalBusinessOfficialGrant.ts",
    "server/services/customerService.ts",
])

def mapped(path):
    if path.startswith("shared/"):
        return base / path
    if path.startswith(("server/", "drizzle/")):
        return base / "front-router-types" / path
    return None

# Traverse only genuinely missing snapshot dependencies. Existing modules remain
# untouched unless explicitly in the real changed-contract whitelist above.
pending = list(paths)
visited = set()
while pending:
    path = pending.pop()
    if path in visited or ".test." in path or path.endswith("Fixture.ts"):
        continue
    visited.add(path)
    source = front / path
    if mapped(path) is None or not source.is_file():
        continue
    for match in re.finditer(r'''["'](@shared/[^"'\n]+|\.\.?/[^"'\n]+)["']''', source.read_text()):
        specifier = match.group(1)
        target = (front / "shared" / specifier[len("@shared/"):]) if specifier.startswith("@shared/") else (source.parent / specifier).resolve()
        if not target.suffix:
            target = Path(str(target) + ".ts")
        if not target.is_file():
            continue
        try:
            relative = target.relative_to(front).as_posix()
        except ValueError:
            continue
        destination = mapped(relative)
        if destination is not None and not destination.exists() and relative not in paths:
            paths.add(relative)
            pending.append(relative)

for path in sorted(paths):
    if ".test." in path or path.endswith("Fixture.ts"):
        continue
    destination = mapped(path)
    source = front / path
    if destination is None or not source.is_file():
        continue
    content = source.read_text()
    def rewrite(match):
        specifier = match.group("path")
        if specifier.startswith("@shared/"):
            target = front / "shared" / specifier[len("@shared/"):]
        elif specifier.startswith(("./", "../")):
            target = (source.parent / specifier).resolve()
        else:
            return match.group()
        try:
            relative = target.relative_to(front).as_posix()
        except ValueError:
            return match.group()
        new_target = mapped(relative)
        if new_target is None:
            return match.group()
        new_specifier = os.path.relpath(new_target, destination.parent)
        if not new_specifier.startswith("."):
            new_specifier = "./" + new_specifier
        return match.group("quote") + new_specifier + match.group("quote")
    content = re.sub(r'''(?P<quote>["'])(?P<path>(?:@shared/|\.\.?/)[^"'\n]+)(?P=quote)''', rewrite, content)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(content)
    print(destination.relative_to(args.admin.resolve()))
