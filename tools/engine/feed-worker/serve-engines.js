// Serves the signed Bunmaska engine feed from the bunmaska-engines R2 bucket.
// Read-only, public, long-cache (engine ids are content-addressed + immutable).
export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed', { status: 405 });
    }
    const key = decodeURIComponent(new URL(request.url).pathname.slice(1));
    if (!key) return new Response('bunmaska engine feed\n', { status: 200 });
    const obj = await env.ENGINES.get(key);
    if (!obj) return new Response('not found\n', { status: 404 });
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('etag', obj.httpEtag);
    headers.set('cache-control', 'public, max-age=31536000, immutable');
    headers.set('access-control-allow-origin', '*');
    return new Response(request.method === 'HEAD' ? null : obj.body, { headers });
  },
};
