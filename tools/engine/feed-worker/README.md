# Engine feed Worker

Serves the signed engine feed (`<id>.tar.zst` + `.json` + `.sig`, plus `index.json`)
at `https://engines.bunmaska.org`, the `DEFAULT_ENGINE_FEED_URL` that
`bunmaska engine install <id>` fetches from.

It's a read-only Cloudflare Worker with an R2 binding to the `bunmaska-engines`
bucket. A Worker (rather than R2's built-in custom-domain serving) so the hostname
maps to the bucket deterministically via the binding. Engine objects get an
immutable long cache; `index.json` is served uncached. Public, GET/HEAD only, CORS-open.

Deploy (needs Cloudflare account creds; see the private hosting runbook):

```sh
cd tools/engine/feed-worker
CLOUDFLARE_EMAIL=... CLOUDFLARE_API_KEY=... CLOUDFLARE_ACCOUNT_ID=... \
  bunx wrangler@4 deploy
```

Publish a packed engine with `publish-engine-r2.ts`: it uploads the three objects
and merges the engine into `index.json`, which `bunmaska engine available` reads.
Raw `wrangler r2 object put` skips the index, so the engine never gets listed.

```sh
bun tools/engine/publish-engine-r2.ts <feedDir> <engineId> --bucket bunmaska-engines
```

Self-hosting your own mirror: point `engine.feed = { url, publicKey }` in
`bunmaska.config` at your own deployment of this Worker + bucket.
