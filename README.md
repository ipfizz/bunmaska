# Bunmaska — monorepo

The home of [Bunmaska](./packages/bunmaska) and everything built around it. A Bun workspace; no extra task runner.

## What's in here

| Path | What it is |
|---|---|
| [`packages/bunmaska`](./packages/bunmaska) | **The framework** — a drop-in Electron replacement on Bun + WebKit. Published to npm as `bunmaska`. |
| [`apps/web`](./apps/web) | **The website + docs** — [bunmaska.org](https://bunmaska.org). Astro, deployed to Cloudflare Pages. |

Future neighbours slot in without rework: `apps/chai` (the app store), `examples/*` (starter boilerplates), more `packages/*`.

## Working in here

```sh
bun install          # install every workspace
bun run validate     # lint + type-check + test (the framework)
bun run build        # build the website
bun run dev          # run the website locally
```

Target one workspace with `--filter`, e.g. `bun run --filter bunmaska test` or `bun run --filter @bunmaska/web dev`.

## License

[MIT](./LICENSE).
