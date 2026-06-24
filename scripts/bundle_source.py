#!/usr/bin/env python3
"""Bundle the project's source files into a single Markdown document.

Walks the project, includes source/config files, skips generated artifacts,
node_modules, lockfiles, logs, and any binary/static assets. Produces a
language-tagged code block per file with a clickable table of contents.
"""
import os
import sys

ROOT = "/home/ubuntu/kes5m-tracker"
OUT = "/home/ubuntu/kes5m-tracker-source.md"

# Directories to skip entirely (anywhere in the tree).
SKIP_DIRS = {
    "node_modules", ".git", "dist", "build", ".manus-logs", "__manus__",
    "patches", ".vite", "coverage", "scripts",
}
# Specific path fragments to skip.
SKIP_PATH_FRAGMENTS = {
    "client/public/__manus__",
    "drizzle/meta",
}
# File names to skip.
SKIP_FILES = {
    "pnpm-lock.yaml", "vite.config.ts.bak", ".gitignore", ".prettierignore",
    ".prettierrc", ".gitkeep", "debug-collector.js", "version.json",
    "comp_dump.json", "segment_notes.sql",
}
# Allowed extensions (source + config we want in the bundle).
ALLOW_EXT = {
    ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".css", ".html",
    ".md", ".sql", ".d.ts",
}

LANG = {
    ".ts": "ts", ".tsx": "tsx", ".js": "js", ".mjs": "js", ".cjs": "js",
    ".json": "json", ".css": "css", ".html": "html", ".md": "markdown",
    ".sql": "sql",
}


def lang_for(path: str) -> str:
    for ext, l in LANG.items():
        if path.endswith(ext):
            return l
    return ""


def allowed(path: str) -> bool:
    return any(path.endswith(e) for e in ALLOW_EXT)


def slug(rel: str) -> str:
    out = []
    for ch in rel.lower():
        if ch.isalnum():
            out.append(ch)
        elif ch in "-_/. ":
            out.append("-")
    s = "".join(out)
    while "--" in s:
        s = s.replace("--", "-")
    return s.strip("-")


def main() -> None:
    files = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        rel_dir = os.path.relpath(dirpath, ROOT)
        if any(frag in rel_dir.replace(os.sep, "/") for frag in SKIP_PATH_FRAGMENTS):
            continue
        for fn in filenames:
            if fn in SKIP_FILES:
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, ROOT).replace(os.sep, "/")
            if not allowed(full):
                continue
            if rel.startswith("client/public/"):
                # only keep tiny config files, skip media
                if not (fn.endswith(".html") or fn.endswith(".txt") or fn.endswith(".json")):
                    continue
            try:
                if os.path.getsize(full) > 600_000:
                    continue
            except OSError:
                continue
            files.append(rel)

    # Order: top-level config, shared, drizzle, server, client, then the rest.
    def sort_key(rel: str):
        order = 9
        if "/" not in rel:
            order = 0
        elif rel.startswith("shared/"):
            order = 1
        elif rel.startswith("drizzle/"):
            order = 2
        elif rel.startswith("server/"):
            order = 3
        elif rel.startswith("client/"):
            order = 4
        return (order, rel)

    files.sort(key=sort_key)

    lines = []
    lines.append("# KES 5M Investment Tracker — Full Source Code\n")
    lines.append(
        "This document contains the complete source of the application "
        "(React 19 + Tailwind 4 + Express 4 + tRPC 11 + Drizzle). "
        "Framework-generated files, `node_modules`, lockfiles, logs, and binary "
        "assets are omitted. Each section is one file.\n"
    )
    lines.append(f"> Files included: **{len(files)}**\n")
    lines.append("\n## Table of Contents\n")
    last_group = None
    group_label = {
        0: "Project config", 1: "shared/", 2: "drizzle/ (schema & migrations)",
        3: "server/", 4: "client/", 9: "other",
    }
    for rel in files:
        grp = sort_key(rel)[0]
        if grp != last_group:
            lines.append(f"\n**{group_label.get(grp, 'other')}**\n")
            last_group = grp
        lines.append(f"- [`{rel}`](#{slug(rel)})")
    lines.append("\n\n---\n")

    for rel in files:
        full = os.path.join(ROOT, rel)
        try:
            with open(full, "r", encoding="utf-8") as f:
                content = f.read()
        except (UnicodeDecodeError, OSError):
            continue
        lines.append(f"\n## {rel}\n")
        lines.append(f'<a id="{slug(rel)}"></a>\n')
        fence = "```"
        # If content contains a triple backtick, use a longer fence.
        if "```" in content:
            fence = "~~~~"
        lines.append(f"{fence}{lang_for(full)}")
        lines.append(content.rstrip("\n"))
        lines.append(fence)

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    size = os.path.getsize(OUT)
    print(f"Wrote {OUT} ({size:,} bytes), {len(files)} files")


if __name__ == "__main__":
    sys.exit(main())
