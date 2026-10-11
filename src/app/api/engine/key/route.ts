/** GET /api/engine/key -- the engine's X25519 public key, for sealing an agent key to it. */
import { enginePublicKey } from '@/lib/agent-engine';

export const dynamic = 'force-dynamic';

export function GET() {
  try {
    return Response.json({ publicKey: enginePublicKey() });
  } catch {
    return Response.json({ error: 'engine not configured' }, { status: 503 });
  }
}
