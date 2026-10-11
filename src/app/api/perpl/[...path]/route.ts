/**
 * Same-origin relay to the Perpl REST API.
 *
 * Perpl rejects requests that carry a browser Origin it hasn't allowlisted, but
 * accepts origin-less (server/SDK-style) calls. The browser still does every
 * signature itself -- wallet EIP-712 + Ed25519 -- so this relay never sees a key;
 * it only forwards the signed bytes and the four X-API-* headers unchanged.
 *
 * Only the Perpl paths the app needs are reachable, so this is not an open proxy.
 */
import { PERPL } from '@/lib/config';

const ALLOWED = /^\/v1\/(api-key\/(payload|enroll)|trading\/(wallet|orders|positions|fills)|pub\/context|market-data\/[\w/-]+)$/;
const FORWARD = ['content-type', 'x-api-key', 'x-api-timestamp', 'x-api-nonce', 'x-api-signature'];
// Perpl answers 451 to US traffic. The relay runs in bom1 (vercel.json), so pass that
// restriction through to the end user instead of laundering it via our region.
const RESTRICTED = new Set(['US']);

async function relay(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = `/${(await params).path.join('/')}`;
  if (!ALLOWED.test(path)) return Response.json({ error: 'path not allowed' }, { status: 404 });
  if (RESTRICTED.has(req.headers.get('x-vercel-ip-country') ?? '')) {
    return Response.json({ error: 'Perpl is not available in your region' }, { status: 451 });
  }

  const headers = new Headers();
  for (const h of FORWARD) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const { search } = new URL(req.url);
  const body = req.method === 'POST' ? await req.text() : undefined;
  const res = await fetch(`${PERPL.api}${path}${search}`, { method: req.method, headers, body, cache: 'no-store' });

  return new Response(res.body, {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
  });
}

export { relay as GET, relay as POST };
