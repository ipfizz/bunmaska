#!/usr/bin/env python3
"""Map changed repo paths to the site URLs worth an IndexNow ping.

usage: indexnow-urls.py <dist-dir> < changed-files.txt

Prints one URL per line. A change under a site-wide file (layout, component,
stylesheet, nav/site data, config) prints every sitemap URL; a change to one
docs page or one route prints just that URL; anything else prints nothing, so
the caller can skip the ping. IndexNow asks for changed URLs only, never the
whole sitemap on every deploy.
"""

import glob
import re
import sys

SITE = "https://bunmaska.org"
SITEWIDE = (
    "website/src/components/",
    "website/src/layouts/",
    "website/src/styles/",
    "website/src/nav.ts",
    "website/src/site.ts",
    "website/src/rehype-copy-button.mjs",
    "website/astro.config.mjs",
    "website/package.json",
)
# Data files that feed exactly one route.
ROUTE_DATA = {
    "website/src/faq.ts": SITE,
    "website/src/roadmap-data.ts": f"{SITE}/roadmap",
}


def sitemap_urls(dist: str) -> list[str]:
    urls: list[str] = []
    for path in sorted(glob.glob(f"{dist}/sitemap-*.xml")):
        with open(path, encoding="utf-8") as f:
            urls += re.findall(r"<loc>([^<]+)</loc>", f.read())
    return [u for u in urls if not u.endswith(".xml")]


def main() -> None:
    dist = sys.argv[1]
    known = sitemap_urls(dist)
    changed = [line.strip() for line in sys.stdin if line.strip()]
    wanted: set[str] = set()
    for path in changed:
        if path.startswith(SITEWIDE):
            print("\n".join(known))
            return
        if path in ROUTE_DATA:
            wanted.add(ROUTE_DATA[path])
            continue
        doc = re.match(r"website/src/content/docs/(.+)\.mdx?$", path)
        if doc:
            wanted.add(f"{SITE}/docs/{doc.group(1)}")
            continue
        page = re.match(r"website/src/pages/(.+)\.astro$", path)
        if page:
            name = page.group(1)
            if name.startswith("docs/") or name == "404":
                continue
            wanted.add(SITE if name == "index" else f"{SITE}/{name}")
    for url in known:
        if url in wanted:
            print(url)


if __name__ == "__main__":
    main()
