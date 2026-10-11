/**
 * GET /api/region -- the visitor's country as Vercel sees it, and whether Perpl (and so
 * trading on Tandem) is unavailable there. The landing page uses it to offer a read-only
 * view up front instead of failing halfway through setup.
 */
import { RESTRICTED_COUNTRIES as RESTRICTED } from '@/lib/config';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  const country = req.headers.get('x-vercel-ip-country') ?? '';
  return Response.json({ country, restricted: RESTRICTED.has(country) });
}
