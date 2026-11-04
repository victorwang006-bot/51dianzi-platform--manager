#!/usr/bin/env python3
"""Sync only changed backend/shared contract files using the existing snapshot layout."""
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

def mapped(path):
    if path.startswith("shared/"):
        return base / path
    if path.startswith(("server/", "drizzle/")):
        return base / "front-router-types" / path
    return None

for path in sorted(paths):
    if ".test." in path or path.endswith("Fixture.ts"):
        continue
    destination = mapped(path)
    source = front / path
    if not destination or not source.is_file():
        continue
    content = source.read_text()
    def rewrite(match):
        target = source.parent.joinpath(match.group("path")).resolve()
        try:
            relative = target.relative_to(front).as_posix()
        except ValueError:
            return match.group()
        new_target = mapped(relative)
        if not new_target:
            return match.group()
        specifier = os.path.relpath(new_target, destination.parent)
        if not specifier.startswith("."):
            specifier = "./" + specifier
        return match.group("quote") + specifier + match.group("quote")
    content = re.sub(r'''(?P<quote>["'])(?P<path>\.\.?/[^"'\n]+)(?P=quote)''', rewrite, content)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(content)
    print(destination.relative_to(args.admin.resolve()))
