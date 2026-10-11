/**
 * POST /api/cron -- the always-on heartbeat. Runs one copy pass for every active agent and,
 * with ?bots=1, one decision for each demo-leader bot. Called every ~15s by the GitHub
 * Actions heartbeat (.github/workflows/heartbeat.yml); the Chainlink CRE workflow calls
 * /api/engine/tick for drifted agents only.
 * Auth: same bearer token as /api/engine/tick.
 */
import { timingSafeEqual } from 'node:crypto';
import { tick, tickToken } from '@/lib/agent-engine';
import { botTick } from '@/lib/demo-trader';
import { refillTreasury } from '@/lib/treasury';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const got = Buffer.from((req.headers.get('authorization') ?? '').replace(/^Bearer /, ''));
  const want = Buffer.from(tickToken());
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const bots = new URL(req.url).searchParams.get('bots') === '1';
  try {
    // Bots first, so a leader's new position is copied in the same heartbeat.
    const botReports = bots ? await botTick() : [];
    const agents = await tick();
    const treasury = bots ? await refillTreasury().catch((e) => `error: ${(e as Error).message.split('\n')[0]}`) : undefined;
    return Response.json({ at: Date.now(), bots: botReports, agents, treasury });
  } catch (e) {
    console.error('cron failed', e);
    return Response.json({ error: (e as Error).message.split('\n')[0] }, { status: 500 });
  }
}
