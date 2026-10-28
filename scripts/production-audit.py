#!/usr/bin/env python3
"""Read-only ECS provenance snapshot. Run on the server; never deploys or reads .env."""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from collections import deque
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

SCHEMA = "51dianzi-production-provenance/v1"


class EntryParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []
        self.maps = {}
        self.in_map = False
        self.map_text = ""

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("type") == "importmap":
            self.in_map = True
            self.map_text = ""
        for key in ("src", "href"):
            value = attrs.get(key, "")
            if value.startswith("/") and not value.startswith("//"):
                self.refs.append(value)

    def handle_data(self, data):
        if self.in_map:
            self.map_text += data

    def handle_endtag(self, tag):
        if tag == "script" and self.in_map:
            try:
                parsed = json.loads(self.map_text)
                imports = parsed.get("imports", {}) if isinstance(parsed, dict) else {}
                if isinstance(imports, dict):
                    self.maps.update({key: value for key, value in imports.items()
                                      if isinstance(key, str) and isinstance(value, str)})
            except (ValueError, TypeError):
                pass
            self.in_map = False


def safe_file(path):
    return path.is_file() and path.suffix.lower() in {
        ".html", ".js", ".mjs", ".cjs", ".css", ".json", ".ico", ".png", ".webp", ".svg", ".woff", ".woff2"
    } and path.name not in {".env", "runtime.env"}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-files", type=int, default=1200)
    ap.add_argument("--max-bytes", type=int, default=134217728)
    args = ap.parse_args()
    if args.max_files < 1 or args.max_bytes < 1:
        ap.error("limits must be positive")
    result = {
        "schema": SCHEMA,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "read_only": True,
        "processes": [],
        "sites": [],
        "files": {},
        "warnings": [],
        "database_schema": "not queried; requires separate approved isolated migration verification",
        "secrets": "environment values, key files and business uploads excluded",
    }
    try:
        proc = subprocess.run(["pm2", "jlist"], check=True, capture_output=True, text=True, timeout=20)
        rows = json.loads(proc.stdout)
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        result["warnings"].append("PM2 status unavailable: " + type(exc).__name__)
        rows = []
    queue = deque()
    protected = set()
    for row in rows:
        name = row.get("name", "")
        if not name.startswith("dianzi51"):
            continue
        env = row.get("pm2_env", {})
        cwd = Path(env.get("pm_cwd", "/nonexistent"))
        executable = Path(env.get("pm_exec_path", "/nonexistent"))
        item = {"name": name, "pid": row.get("pid"), "status": env.get("status"),
                "cwd": str(cwd), "executable": str(executable),
                "restarts": env.get("restart_time"), "unstable_restarts": env.get("unstable_restarts")}
        result["processes"].append(item)
        if str(cwd).startswith(("/opt/releases/", "/opt/apps/")):
            protected.add(str(cwd.resolve()))
            dist = cwd / "dist"
            if dist.is_dir():
                # Runtime sidecar modules are part of the serving release too.
                for file in sorted(dist.iterdir()):
                    if safe_file(file):
                        queue.append((file, None))
    configs = [
        ("51dianzi.com", Path("/etc/nginx/conf.d/dianzi51-https.conf")),
        ("admin.51dianzi.com", Path("/etc/nginx/conf.d/dianzi51-admin-subdomain.conf")),
    ]
    for domain, conf in configs:
        if not conf.is_file():
            result["warnings"].append("missing expected Nginx config: " + str(conf))
            continue
        text = conf.read_text()
        root_match = re.search(r"^\s*root\s+([^;]+);", text, re.M)
        if not root_match:
            result["warnings"].append("no static root: " + domain)
            continue
        root = Path(root_match.group(1).strip())
        protected.add(str(root.resolve()))
        entry = root / "index.html"
        site = {"domain": domain, "config": str(conf), "root": str(root), "entry": str(entry),
                "config_sha256": hashlib.sha256(conf.read_bytes()).hexdigest(), "import_map": {}}
        if entry.is_file():
            parser = EntryParser()
            parser.feed(entry.read_text())
            site["import_map"] = parser.maps
            queue.append((entry, (root, parser.maps)))
            for reference in parser.refs + list(parser.maps.values()):
                reference = parser.maps.get(reference, reference)
                if reference.startswith("/") and not reference.startswith("//"):
                    queue.append((root / reference.split("?", 1)[0].lstrip("/"), (root, parser.maps)))
        else:
            result["warnings"].append("entry missing: " + str(entry))
        result["sites"].append(site)
    visited = set()
    total_bytes = 0
    missing = []
    limited = False
    while queue:
        file, context = queue.popleft()
        name = str(file)
        if name in visited:
            continue
        visited.add(name)
        if not safe_file(file):
            if file.suffix in {".js", ".mjs", ".cjs", ".css", ".html"}:
                missing.append(name)
            continue
        size = file.stat().st_size
        if len(result["files"]) >= args.max_files or total_bytes + size > args.max_bytes:
            limited = True
            continue
        data = file.read_bytes()
        result["files"][name] = {"sha256": hashlib.sha256(data).hexdigest(), "bytes": size}
        total_bytes += size
        if file.suffix in {".js", ".mjs", ".cjs", ".css"}:
            text = data.decode("utf-8", errors="replace")
            # Only literal local module imports are followed; computed imports are not certified.
            refs = re.findall(r"[\"']((?:\./|\.\./|/assets/)[^\"'\s]+?\.(?:m?js|cjs|css)(?:\?[^\"']*)?)[\"']", text)
            for reference in refs:
                reference = reference.split("?", 1)[0]
                if context:
                    root, maps = context
                    path = root / reference.lstrip("/") if reference.startswith("/") else (file.parent / reference).resolve()
                    try:
                        absolute_url = "/" + str(path.relative_to(root))
                    except ValueError:
                        absolute_url = reference
                    mapped = maps.get(absolute_url, reference)
                    if mapped.startswith("/"):
                        path = root / mapped.lstrip("/")
                else:
                    if reference.startswith("/"):
                        continue
                    path = (file.parent / reference).resolve()
                if str(path).startswith(("/opt/releases/", "/opt/apps/")):
                    queue.append((path, context))
    result["missing_literal_dependency_candidates"] = sorted(set(missing))
    result["protected_runtime_directories"] = sorted(protected)
    result["scan"] = {"file_count": len(result["files"]), "bytes_hashed": total_bytes,
                      "limited": limited, "max_files": args.max_files, "max_bytes": args.max_bytes,
                      "limits": "literal dependency graph and runtime sidecars only; computed imports, shared Nginx aliases, DB schema and business correctness need separate review"}
    # Disk metadata only; no directory deletion or attachment enumeration.
    for mount in ("/", "/data"):
        try:
            import os
            st = os.statvfs(mount)
            result.setdefault("disk", {})[mount] = {"total_bytes": st.f_blocks * st.f_frsize,
                                                     "available_bytes": st.f_bavail * st.f_frsize}
        except OSError:
            pass
    result["production_equivalence_certified"] = False
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
