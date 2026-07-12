# Engine feed Worker

Serves the signed engine feed (`<id>.tar.zst` + `.json` + `.sig`) at
`https://engines.bunmaska.org` — the `DEFAULT_ENGINE_FEED_URL` that
`bunmaska engine install <id>` fetches from.

It's a read-only Cloudflare Worker with an R2 binding to the `bunmaska-engines`
bucket. A Worker (rather than R2's built-in custom-domain serving) so the hostname
maps to the bucket deterministically via the binding, and objects get an immutable
long cache. Public, GET/HEAD only, CORS-open.

Deploy (needs Cloudflare account creds; see the private hosting runbook):

```sh
cd tools/engine/feed-worker
CLOUDFLARE_EMAIL=... CLOUDFLARE_API_KEY=... CLOUDFLARE_ACCOUNT_ID=... \
  bunx wrangler@4 deploy
```

Publishing a new engine is just uploading its three objects to the bucket:

```sh
bunx wrangler@4 r2 object put bunmaska-engines/<id>.tar.zst      --file <id>.tar.zst      --remote
bunx wrangler@4 r2 object put bunmaska-engines/<id>.tar.zst.json --file <id>.tar.zst.json --remote
bunx wrangler@4 r2 object put bunmaska-engines/<id>.tar.zst.sig  --file <id>.tar.zst.sig  --remote
```

Self-hosting your own mirror: point `engine.feed = { url, publicKey }` in
`bunmaska.config` at your own deployment of this Worker + bucket.
