/** GET /api/trader?id=<accountId> -- one copyable trader, for copy links. */
import { traderById } from '@/lib/leaderboard';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  try {
    const trader = await traderById(id);
    return trader ? Response.json(trader) : Response.json({ error: 'no such trader' }, { status: 404 });
  } catch (e) {
    return Response.json({ error: (e as Error).message.split('\n')[0] }, { status: 502 });
  }
}
