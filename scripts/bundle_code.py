#!/usr/bin/env python3
"""Concatenate all application source files into a single Markdown bundle.

Excludes framework plumbing (server/_core), shadcn ui primitives, generated
files, tests are included (clearly grouped), and lockfiles/deps.
"""
import os
import datetime

ROOT = "/home/ubuntu/kes5m-tracker"
OUT = "/home/ubuntu/kes5m-tracker-full-code.md"

EXT_LANG = {
    ".ts": "ts",
    ".tsx": "tsx",
    ".js": "js",
    ".mjs": "js",
    ".json": "json",
    ".css": "css",
    ".html": "html",
    ".md": "markdown",
    ".sql": "sql",
}

# Ordered sections: (heading, [relative paths or directory-glob specs])
def list_dir(rel, exts, recursive=False, exclude_dirs=None):
    exclude_dirs = exclude_dirs or []
    base = os.path.join(ROOT, rel)
    found = []
    if recursive:
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d not in exclude_dirs]
            for f in sorted(filenames):
                if os.path.splitext(f)[1] in exts:
                    found.append(os.path.relpath(os.path.join(dirpath, f), ROOT))
    else:
        if os.path.isdir(base):
            for f in sorted(os.listdir(base)):
                full = os.path.join(base, f)
                if os.path.isfile(full) and os.path.splitext(f)[1] in exts:
                    found.append(os.path.relpath(full, ROOT))
    return sorted(found)


def section_files():
    sections = []

    # 1. Project meta / config
    meta = [
        "package.json",
        "tsconfig.json",
        "vite.config.ts",
        "vitest.config.ts",
        "drizzle.config.ts",
        "components.json",
        "todo.md",
    ]
    sections.append(("Project Configuration", [m for m in meta if os.path.isfile(os.path.join(ROOT, m))]))

    # 2. Shared logic (the financial core)
    sections.append(("Shared — Financial Logic & Types", list_dir("shared", {".ts"})))

    # 3. Database schema
    sections.append(("Database Schema (Drizzle)", list_dir("drizzle", {".ts"})))

    # 4. Server (app code only — split impl vs tests)
    server_all = list_dir("server", {".ts"}, recursive=False)
    server_impl = [f for f in server_all if not f.endswith(".test.ts")]
    server_tests = [f for f in server_all if f.endswith(".test.ts")]
    sections.append(("Server — tRPC Routers, DB Helpers, Engine, Storage", server_impl))

    # 5. Client app shell, routing, providers
    client_root = []
    for f in ["client/src/App.tsx", "client/src/main.tsx", "client/src/const.ts",
              "client/src/index.css", "client/index.html"]:
        if os.path.isfile(os.path.join(ROOT, f)):
            client_root.append(f)
    sections.append(("Client — App Shell, Routing & Global Styles", client_root))

    # 6. Client contexts, hooks, lib
    misc = []
    misc += list_dir("client/src/contexts", {".ts", ".tsx"})
    misc += list_dir("client/src/hooks", {".ts", ".tsx"})
    misc += list_dir("client/src/lib", {".ts", ".tsx"})
    # drop the generic trpc binding noise? keep it — small and relevant
    sections.append(("Client — Contexts, Hooks & Lib", sorted(misc)))

    # 7. Client feature components (exclude template-only AIChatBox/Map/DashboardLayout primitives? keep app-specific)
    comp = list_dir("client/src/components", {".tsx"})
    sections.append(("Client — Components", comp))

    # 8. Client pages
    pages = list_dir("client/src/pages", {".tsx"})
    sections.append(("Client — Pages", pages))

    # 9. Tests
    sections.append(("Server — Test Suites", server_tests))

    return sections


def fence_for(path):
    return EXT_LANG.get(os.path.splitext(path)[1], "")


def main():
    sections = section_files()
    lines = []
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M %Z")
    lines.append("# KES 5M Investment Tracker — Full Source Code (Round 27)\n")
    lines.append(f"*Generated {now}. Checkpoint version 41acb0b1.*\n")
    lines.append(
        "This bundle contains every application source file. Framework plumbing "
        "(`server/_core`), shadcn/ui primitives (`client/src/components/ui/*`), and "
        "generated/lock files are intentionally omitted. Stack: React 19 + Tailwind 4 "
        "+ Express 4 + tRPC 11 + Drizzle ORM (MySQL/TiDB), tested with Vitest.\n")

    # Table of contents
    lines.append("## Table of Contents\n")
    for i, (title, files) in enumerate(sections, 1):
        anchor = title.lower().replace(" ", "-").replace("—", "").replace("&", "").replace(",", "").replace("(", "").replace(")", "").replace("/", "").replace("--", "-")
        lines.append(f"{i}. **{title}** ({len(files)} files)")
    lines.append("")

    total = 0
    for i, (title, files) in enumerate(sections, 1):
        lines.append(f"\n---\n\n## {i}. {title}\n")
        for rel in files:
            full = os.path.join(ROOT, rel)
            try:
                with open(full, "r", encoding="utf-8") as fh:
                    content = fh.read()
            except Exception as e:
                content = f"<<could not read: {e}>>"
            total += 1
            lines.append(f"### `{rel}`\n")
            fence = fence_for(rel)
            lines.append(f"```{fence}")
            lines.append(content.rstrip("\n"))
            lines.append("```\n")

    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))

    print(f"Wrote {OUT} ({total} files)")
    print(f"Size: {os.path.getsize(OUT)/1024:.1f} KB")


if __name__ == "__main__":
    main()
