import { leaderboard } from '@/lib/leaderboard';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json(await leaderboard());
  } catch (e) {
    console.error('leaderboard failed', e);
    return Response.json({ error: (e as Error).message.split('\n')[0] }, { status: 502 });
  }
}
