/**
 * GET /api/activity?leader=<accountId> -- recent fills of a demo-bot leader, so the app can
 * show "leader traded -> you copied N seconds later". Read-only and public: these trades are
 * already on-chain. Only Tandem's own bots are served (the server holds their read keys).
 */
import { demoLeaders, apiSigner } from '@/lib/demo';
import { loadBotToken } from '@/lib/demo-trader';
import { exchangeAccountOf } from '@/lib/onchain';
import { perplClient, type Fill } from '@/lib/perpl';

export const dynamic = 'force-dynamic';

let ids: Map<string, number> | undefined; // accountId -> index into demoLeaders()
const cache = new Map<string, { at: number; fills: Fill[] }>();

export async function GET(req: Request) {
  const leader = new URL(req.url).searchParams.get('leader') ?? '';
  try {
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
