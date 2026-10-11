/**
 * POST /api/engine/tick -- run one copy pass for every active agent, or only the owners in
 * the body (the Chainlink CRE workflow sends the agents it found drifted).
 * Auth: `Authorization: Bearer <tick token>` (print it with `npm run engine:token`).
 */
import { timingSafeEqual } from 'node:crypto';
import { isAddress, type Hex } from 'viem';
import { tick, tickToken } from '@/lib/agent-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const got = Buffer.from((req.headers.get('authorization') ?? '').replace(/^Bearer /, ''));
  const want = Buffer.from(tickToken());
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function POST(req: Request) {
  try {
    if (!authorized(req)) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const body = (await req.json().catch(() => ({}))) as { owners?: string[] };
    const owners = body.owners?.filter((o): o is Hex => isAddress(o));
    const reports = await tick(owners?.length ? owners : undefined);
    return Response.json({ at: Date.now(), agents: reports.length, reports });
  } catch (e) {
    console.error('engine tick failed', e);
    return Response.json({ error: (e as Error).message.split('\n')[0] }, { status: 500 });
  }
}
