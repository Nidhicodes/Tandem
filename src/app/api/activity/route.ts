/**
 * GET /api/activity?leader=<accountId> -- recent fills of a demo-bot leader, and
 * GET /api/activity?owner=<address>   -- recent fills of a Tandem agent (its copies),
 * so the app can show "leader traded -> you copied N seconds later". Read-only and public:
 * these trades are already on-chain as position events. Only accounts the server holds keys
 * for are served (Tandem's bots and agents); Perpl scopes fills to the key that placed them.
 */
import { isAddress } from 'viem';
import { agentFills } from '@/lib/agent-engine';
import { demoLeaders, apiSigner } from '@/lib/demo';
import { loadBotToken } from '@/lib/demo-trader';
import { exchangeAccountOf } from '@/lib/onchain';
import { perplClient, type Fill } from '@/lib/perpl';

export const dynamic = 'force-dynamic';

let ids: Map<string, number> | undefined; // accountId -> index into demoLeaders()
const cache = new Map<string, { at: number; fills: Fill[] }>();

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const leader = q.get('leader') ?? '';
  const owner = q.get('owner') ?? '';
  try {
    if (owner) {
      if (!isAddress(owner)) return Response.json({ error: 'bad owner' }, { status: 400 });
      const key = `owner:${owner.toLowerCase()}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < 5_000) return Response.json({ fills: hit.fills });
      const fills = (await agentFills(owner).catch(() => [])).slice(0, 20);
      cache.set(key, { at: Date.now(), fills });
      return Response.json({ fills });
    }
    const bots = demoLeaders();
    ids ??= new Map((await Promise.all(bots.map((b) => exchangeAccountOf(b.address)))).flatMap((a, i) => (a ? [[a.id.toString(), i] as const] : [])));
    const i = ids.get(leader);
    if (i === undefined) return Response.json({ fills: [] });
    const hit = cache.get(leader);
    if (hit && Date.now() - hit.at < 8_000) return Response.json({ fills: hit.fills });
    const token = await loadBotToken(bots[i]);
    const fills = token ? (await perplClient(apiSigner(bots[i]), token).fills()).slice(0, 20) : [];
    cache.set(leader, { at: Date.now(), fills });
    return Response.json({ fills });
  } catch (e) {
    return Response.json({ error: (e as Error).message.split('\n')[0] }, { status: 502 });
  }
}
