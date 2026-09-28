#!/usr/bin/env python3
"""Print the sitemap URLs whose source changed; IndexNow wants changed URLs, never the whole sitemap.

usage: indexnow-urls.py <dist-dir> < changed-files.txt
       indexnow-urls.py --self-test
"""

import glob
import re
import sys

SITE = "https://bunmaska.org"
SITEWIDE = (
    "website/src/assets/",
    "website/src/components/",
    "website/src/layouts/",
    "website/src/styles/",
    "website/src/nav.ts",
    "website/src/site.ts",
    "website/src/fonts.ts",
    "website/src/content.config.ts",
    "website/src/rehype-copy-button.mjs",
    "website/astro.config.mjs",
    "website/package.json",
)
ROUTE_DATA = {
    "website/src/faq.ts": (SITE, f"{SITE}/alternatives"),
    "website/src/roadmap-data.ts": (f"{SITE}/roadmap",),
}
DOCS_ROUTE = "website/src/pages/docs/[...slug].astro"


def sitemap_urls(dist: str) -> list[str]:
    locs: list[str] = []
    for path in sorted(glob.glob(f"{dist}/sitemap-*.xml")):
        with open(path, encoding="utf-8") as f:
            locs += re.findall(r"<loc>([^<]+)</loc>", f.read())
    return [u for u in locs if not u.endswith(".xml")]


def urls(changed: list[str], known: list[str]) -> list[str]:
    wanted: set[str] = set()
    for path in changed:
        if path.startswith(SITEWIDE):
            return known
        if path in ROUTE_DATA:
            wanted.update(ROUTE_DATA[path])
            continue
        if path == DOCS_ROUTE:
            wanted.update(url for url in known if url.startswith(f"{SITE}/docs/"))
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
    return [url for url in known if url in wanted]


def self_test() -> None:
    docs = [f"{SITE}/docs/introduction", f"{SITE}/docs/api/app"]
    known = [SITE, f"{SITE}/about", f"{SITE}/alternatives", f"{SITE}/roadmap", *docs]
    assert urls(["website/src/faq.ts"], known) == [SITE, f"{SITE}/alternatives"]
    assert urls(["website/src/pages/docs/[...slug].astro"], known) == docs
    assert urls(["website/src/fonts.ts"], known) == known
    assert urls(["website/src/content.config.ts"], known) == known
    assert urls(["website/src/content/docs/api/app.md", "website/src/pages/about.astro"], known) == [
        f"{SITE}/about",
        f"{SITE}/docs/api/app",
    ]
    assert urls(["README.md", "website/src/pages/404.astro"], known) == []
    print("indexnow-urls self-test ok")


def main() -> None:
    if sys.argv[1] == "--self-test":
        self_test()
        return
    changed = [line.strip() for line in sys.stdin if line.strip()]
    for url in urls(changed, sitemap_urls(sys.argv[1])):
        print(url)


if __name__ == "__main__":
    main()
