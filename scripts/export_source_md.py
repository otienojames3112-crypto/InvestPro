#!/usr/bin/env python3
"""Assemble the KES 5M Investment Tracker source into a single Markdown document.

Excludes framework-level code (server/_core, client/src/_core), generated shadcn/ui
primitives (client/src/components/ui), test files, lockfiles, build output and assets.
"""
import os
from pathlib import Path

ROOT = Path("/home/ubuntu/kes5m-tracker")
OUT = ROOT / "kes5m-tracker-source.md"

# Ordered sections: (heading, [relative paths]).
LANG = {
    ".ts": "ts", ".tsx": "tsx", ".css": "css", ".html": "html",
    ".json": "json", ".js": "js", ".md": "markdown", ".sql": "sql",
}

def collect(globs, excludes=()):
    out = []
    for g in globs:
        for p in sorted(ROOT.glob(g)):
            rel = p.relative_to(ROOT).as_posix()
            if not p.is_file():
                continue
            if any(ex in rel for ex in excludes):
                continue
            out.append(rel)
    # de-dup, preserve order
    seen, res = set(), []
    for r in out:
        if r not in seen:
            seen.add(r)
            res.append(r)
    return res

EXCLUDES = ("/_core/", "/components/ui/", ".test.ts", "/migrations/", "/meta/", "__manus__")

SECTIONS = [
    ("Project Configuration", [
        "package.json", "tsconfig.json", "vite.config.ts", "vitest.config.ts",
        "drizzle.config.ts", "components.json",
    ]),
    ("Database — Drizzle Schema & Relations", [
        "drizzle/schema.ts", "drizzle/relations.ts",
    ]),
    ("Shared (client + server)", sorted(
        [p.relative_to(ROOT).as_posix() for p in (ROOT / "shared").glob("*.ts")
         if "_core" not in p.as_posix()]
    )),
    ("Server — Projection Engine, DB Helpers, tRPC Routers, Storage", [
        "server/engine.ts", "server/db.ts", "server/routers.ts", "server/storage.ts",
    ]),
    ("Client — Entry, App, Global Styles", [
        "client/index.html", "client/src/main.tsx", "client/src/App.tsx",
        "client/src/index.css", "client/src/const.ts",
    ]),
    ("Client — Contexts", sorted(
        [p.relative_to(ROOT).as_posix() for p in (ROOT / "client/src/contexts").glob("*.tsx")]
    )),
    ("Client — Hooks", sorted(
        [p.relative_to(ROOT).as_posix() for p in (ROOT / "client/src/hooks").glob("*.ts*")]
    )),
    ("Client — Lib", sorted(
        [p.relative_to(ROOT).as_posix() for p in (ROOT / "client/src/lib").glob("*.ts")]
    )),
    ("Client — App Components", [
        "client/src/components/AppShell.tsx",
        "client/src/components/DepositDrawer.tsx",
        "client/src/components/ModeSwitcher.tsx",
        "client/src/components/PortfolioSelector.tsx",
        "client/src/components/SecondaryWhatIf.tsx",
        "client/src/components/UpdateRatesPanel.tsx",
    ]),
    ("Client — Pages", sorted(
        [p.relative_to(ROOT).as_posix() for p in (ROOT / "client/src/pages").glob("*.tsx")
         if p.name not in ("ComponentShowcase.tsx",)]
    )),
]


def fence_for(rel):
    ext = os.path.splitext(rel)[1]
    return LANG.get(ext, "")


def main():
    lines = []
    lines.append("# KES 5M Investment Tracker — Full Source Code\n")
    lines.append(
        "A React 19 + Tailwind 4 + Express + tRPC application that projects a 10-year "
        "journey to KES 5,000,000 across Money Market Funds and CBK government securities, "
        "and reconciles the projection against live recorded holdings.\n"
    )
    lines.append(
        "> This document contains the application-level source only. Framework plumbing "
        "(`server/_core`, `client/src/_core`), generated shadcn/ui primitives "
        "(`client/src/components/ui`), test specs, migrations and lockfiles are omitted.\n"
    )

    # Table of contents
    lines.append("## Table of Contents\n")
    for i, (title, files) in enumerate(SECTIONS, 1):
        anchor = title.lower().replace(" — ", "--").replace(" ", "-")
        anchor = "".join(c for c in anchor if c.isalnum() or c in "-")
        lines.append(f"{i}. [{title}](#{anchor})")
    lines.append("")

    total_files = 0
    for title, files in SECTIONS:
        lines.append(f"\n## {title}\n")
        for rel in files:
            p = ROOT / rel
            if not p.is_file():
                continue
            if any(ex in ("/" + rel) for ex in EXCLUDES):
                continue
            total_files += 1
            try:
                content = p.read_text(encoding="utf-8")
            except Exception as e:  # noqa
                content = f"[could not read file: {e}]"
            lines.append(f"\n### `{rel}`\n")
            fence = fence_for(rel)
            lines.append(f"```{fence}")
            lines.append(content.rstrip("\n"))
            lines.append("```")
        lines.append("")

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT} — {total_files} files, {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
