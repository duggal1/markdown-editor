#!/usr/bin/env python3
"""Regenerate the two README illustrations. Python 3, standard library only.

The static composition follows design.md: borderless neutral surfaces, compact
controls, Geist-style typography and the actual ribbon F. No external fonts,
network, JS, fake performance metrics or gradients. SVGs are illustrative.
Run from any directory; --check verifies checked-in bytes without writing.
"""
import argparse
import re
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "readme"
FONT = "Geist, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
STYLE = ".muted{fill:#a3a3a3}.quiet{fill:#858585}"
SCENES = {
    "workspace.svg": {
        "w": 1120,
        "h": 444,
        "title": "Flow workspace",
        "desc": "Illustrative dark split Markdown editor with private page tree and live rendered preview.",
        "body": """<rect width="1120" height="444" rx="18" fill="#080808"/>
<g transform="translate(31 24)">
  <g transform="scale(1.36) translate(-2 -1)">{{MARK}}</g>
  <text x="43" y="26" font-size="24" font-weight="500" letter-spacing="-1">Flow</text>
</g>
<text x="1088" y="49" text-anchor="end" class="muted" font-size="14">A local-first workspace</text>
<rect x="28" y="77" width="1064" height="334" rx="12" fill="#101010"/>
<path d="M40 77H244V411H40Q28 411 28 399V89Q28 77 40 77Z" fill="#0e0e0e"/>
<path d="M658 120H1092V399Q1092 411 1080 411H658Z" fill="#0a0a0a"/>
<g class="quiet" font-size="13">
  <text x="47" y="104" font-size="15" fill="#fafafa">Private</text>
  <path d="M216 97h10m-5-5v10" stroke="#a3a3a3" stroke-width="1.4" stroke-linecap="round"/>
  <text x="47" y="133">Search</text><text x="225" y="133" text-anchor="end">⌘ K</text>
  <rect x="39" y="149" width="194" height="28" rx="6" fill="#1a1a1a"/>
  <g fill="none" stroke="#a3a3a3" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M49 156h7l4 4v11H49Z M56 156v4h4"/>
    <path d="M49 188h7l4 4v11H49Z M56 188v4h4"/>
    <path d="M49 220h7l4 4v11H49Z M56 220v4h4"/>
    <path d="M49 252h7l4 4v11H49Z M56 252v4h4"/>
  </g>
  <text x="69" y="168" fill="#fafafa">Engineering notes</text>
  <text x="69" y="200">Architecture.md</text><text x="69" y="232">Design.md</text><text x="69" y="264">Prototype.html</text>
  <path d="M48 375l6-6 6 6-6 6Z" stroke="#a3a3a3" fill="none" stroke-width="1.2"/>
  <text x="69" y="379">Draw</text>
</g>
<g font-size="13">
  <text x="267" y="104" class="muted">Private</text><text x="313" y="104" class="quiet">/</text><text x="327" y="104">Engineering notes</text>
  <rect x="605" y="86" width="171" height="26" rx="7" fill="#161616"/>
  <text x="633" y="103" class="muted" text-anchor="middle">Write</text>
  <rect x="661" y="88" width="55" height="22" rx="5" fill="#292929"/>
  <text x="689" y="103" text-anchor="middle">Split</text><text x="746" y="103" class="muted" text-anchor="middle">Preview</text>
  <circle cx="994" cy="99" r="3" fill="#a3a3a3"/><text x="1004" y="104" class="muted">Saved</text>
  <text x="1076" y="104" text-anchor="end">Share</text>
</g>
<g font-family="SFMono-Regular, Consolas, Liberation Mono, monospace" font-size="14">
  <text x="278" y="155"><tspan fill="#bd87fa">#</tspan> Engineering notes</text>
  <text x="278" y="189" fill="#d4d4d4">Keep the source simple.</text>
  <text x="278" y="211" fill="#d4d4d4">Move expensive work off the main thread.</text>
  <text x="278" y="249"><tspan fill="#bd87fa">##</tspan> The plan</text>
  <text x="278" y="280"><tspan fill="#bd87fa">- [x]</tspan> Save locally</text>
  <text x="278" y="306"><tspan fill="#bd87fa">- [x]</tspan> Render the preview</text>
  <text x="278" y="332"><tspan fill="#bd87fa">- [ ]</tspan> Verify the export</text>
  <path d="M278 350v17" stroke="#bd87fa" stroke-width="1.5"/>
</g>
<g transform="translate(688 0)">
  <text y="161" font-size="27" font-weight="500" letter-spacing="-.9">Engineering notes</text>
  <text y="197" font-size="15" fill="#d4d4d4">Keep the source simple.</text>
  <text y="219" font-size="15" fill="#d4d4d4">Move expensive work off the main thread.</text>
  <text y="255" font-size="19" font-weight="500" letter-spacing="-.4">The plan</text>
  <g font-size="15" fill="#d4d4d4">
    <rect y="271" width="13" height="13" rx="3" fill="#a855f7"/><path d="M3 277l3 3 4-5" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="23" y="282">Save locally</text>
    <rect y="297" width="13" height="13" rx="3" fill="#a855f7"/><path d="M3 303l3 3 4-5" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="23" y="308">Render the preview</text>
    <rect y="323" width="13" height="13" rx="3" fill="#262626"/><text x="23" y="334">Verify the export</text>
  </g>
</g>
<text x="32" y="431" font-size="11" class="quiet">Workspace illustration · sample content</text>""",
    },
    "architecture.svg": {
        "w": 1120,
        "h": 356,
        "title": "Flow architecture",
        "desc": "CodeMirror and document state feed the preview pipeline and IndexedDB. Optional cloud APIs use a selectable storage adapter.",
        "body": """<rect width="1120" height="356" rx="18" fill="#080808"/>
<text x="32" y="39" font-size="21" font-weight="500" letter-spacing="-.5">Source first. Cloud optional.</text>
<text x="1088" y="38" text-anchor="end" font-size="13" class="muted">Browser execution / server boundary</text>
<rect x="28" y="61" width="1064" height="165" rx="11" fill="#101010"/>
<text x="45" y="84" font-size="12" class="quiet">Browser · React / Vite</text>
<g fill="none" stroke="#565656" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M222 132H284m-6-5 6 5-6 5"/>
  <path d="M476 132H536m-6-5 6 5-6 5"/>
  <path d="M476 159H506V194H773V159H788m-6-5 6 5-6 5"/>
  <path d="M878 178V239m-5-6 5 6 5-6" stroke-dasharray="3 5"/>
</g>
<rect x="45" y="101" width="177" height="77" rx="8" fill="#181818"/>
<rect x="284" y="101" width="192" height="77" rx="8" fill="#181818"/>
<rect x="536" y="101" width="214" height="77" rx="8" fill="#181818"/>
<rect x="788" y="101" width="287" height="77" rx="8" fill="#181818"/>
<g font-size="17" font-weight="500">
  <text x="59" y="128">CodeMirror 6</text><text x="298" y="128">Document state</text>
  <text x="550" y="128">Preview pipeline</text><text x="802" y="128">IndexedDB</text>
</g>
<g font-size="13" class="muted">
  <text x="59" y="151">Transactions / undo</text><text x="298" y="151">React + source text</text>
  <text x="550" y="151">Worker / virtualized UI</text><text x="802" y="151">Documents / folders / assets</text>
  <text x="536" y="212">Serialized, debounced writes</text><text x="45" y="212">Local editing never waits on the cloud.</text>
</g>
<rect x="28" y="245" width="1064" height="83" rx="11" fill="#101010"/>
<text x="45" y="270" font-size="12" class="quiet">Optional cloud</text>
<text x="45" y="299" font-size="16">Backup · Share · HTML hosting</text>
<path d="M322 294h69m-6-5 6 5-6 5M634 294h70m-6-5 6 5-6 5" stroke="#565656" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
<text x="408" y="288" font-size="16">Vercel API routes</text>
<text x="408" y="309" font-size="12" class="muted">Versioned manifests / signed parts</text>
<text x="720" y="288" font-size="16">Storage adapter</text>
<text x="720" y="309" font-size="12" class="muted">Vercel Blob or Drizzle / PostgreSQL</text>
<text x="1088" y="344" text-anchor="end" class="quiet" font-size="11">Logical data flow · not a deployment claim</text>""",
    },
}


def read_mark():
    source = (ROOT / "public" / "flow.svg").read_text(encoding="utf-8")
    root = ET.fromstring(source)
    if root.attrib.get("viewBox") != "0 0 26 26":
        raise ValueError("Flow mark geometry changed; review the README placement")
    paths = re.findall(r"<path\b[^>]*\/>", source)
    if not paths or len(paths) != len(root) or any(
        child.tag.rsplit("}", 1)[-1] != "path" for child in root
    ):
        raise ValueError("Flow mark structure changed; review the embed")
    return "".join(paths)


def render(scene, mark):
    w, h = scene["w"], scene["h"]
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}" role="img" font-family="{FONT}" fill="#fafafa">\n'
        f'<title>{scene["title"]}</title><desc>{scene["desc"]}</desc>\n'
        f'<style>{STYLE}</style>\n'
        + scene["body"].replace("{{MARK}}", mark) + "\n</svg>\n"
    )
    ET.fromstring(svg)
    return svg.encode("utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    mark = read_mark()
    if not args.check:
        OUT.mkdir(parents=True, exist_ok=True)
    stale = []
    for name, scene in SCENES.items():
        expected = render(scene, mark)
        path = OUT / name
        if args.check:
            if not path.is_file() or path.read_bytes() != expected:
                stale.append(name)
        else:
            path.write_bytes(expected)
    if stale:
        parser.exit(1, "Stale README assets: " + ", ".join(stale) + "\n")
    print(f"{'Verified' if args.check else 'Generated'} {len(SCENES)} SVGs")


if __name__ == "__main__":
    main()
