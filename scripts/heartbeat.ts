// Event-driven heartbeat for the deployed app.
//   npm run heartbeat   (env: TANDEM_URL, TANDEM_TICK_TOKEN, NEXT_PUBLIC_AGENTS_ADDRESS, RUN_MINUTES)
//
// Watches the Perpl Exchange over a Monad WebSocket and, the moment a leader that someone
// copies has a position event, calls POST /api/cron so followers are copied in seconds rather
// than on the next poll. A 15s baseline beat still runs (self-healing), demo bots decide every
// 2 minutes, and the treasury refills on the same beat. Runs in GitHub Actions; see
// .github/workflows/heartbeat.yml.
import { decodeEventLog, type Hex } from 'viem';
import { listAgents } from '../src/lib/agents';
import { PERPL } from '../src/lib/config';
import { positionEvents } from '../src/lib/exchange-abi';

const URL = (process.env.TANDEM_URL ?? 'https://tandem-omega-opal.vercel.app').replace(/\/$/, '');
const TOKEN = process.env.TANDEM_TICK_TOKEN;
const WS = process.env.MONAD_WS ?? 'wss://testnet-rpc.monad.xyz';
const END = Date.now() + Number(process.env.RUN_MINUTES ?? 345) * 60_000;
const BASE_MS = 15_000;
const BOTS_MS = 120_000;
const DEBOUNCE_MS = 800; // let a multi-fill order land before copying

if (!TOKEN) throw new Error('TANDEM_TICK_TOKEN is not set');
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---- the beat: one /api/cron call at a time; a request during a call runs right after it
let inFlight = false;
let again: { bots: boolean; why: string } | undefined;
let lastBeat = 0;
let lastBots = 0;

async function beat(bots: boolean, why: string) {
  if (inFlight) {
    again = { bots: bots || !!again?.bots, why };
    return;
  }
  inFlight = true;
  lastBeat = Date.now();
  if (bots) lastBots = lastBeat;
  try {
    const res = await fetch(`${URL}/api/cron${bots ? '?bots=1' : ''}`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(55_000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) log(why, `HTTP ${res.status}`, JSON.stringify(body).slice(0, 300));
    for (const b of body.bots ?? []) if (b.action !== 'hold') log(why, `[${b.bot}]`, b.market ?? '', b.action);
    for (const a of body.agents ?? []) for (const l of a.logs ?? []) log(why, a.owner.slice(0, 8), `#${a.leader}`, l.text);
    for (const a of body.agents ?? []) if (a.error) log(why, a.owner.slice(0, 8), 'error', a.error);
    if (body.treasury === 'claimed') log(why, 'treasury +faucet');
  } catch (e) {
    log(why, 'beat failed', (e as Error).message);
  } finally {
    inFlight = false;
    const next = again;
    again = undefined;
    if (next) void beat(next.bots, next.why);
  }
}

// ---- who to watch: leaders of active agents, refreshed every minute
let leaders = new Set<string>();
async function refreshLeaders() {
  try {
    leaders = new Set((await listAgents()).filter((a) => !a.halted).map((a) => a.leader.toString()));
  } catch (e) {
    log('agent list failed', (e as Error).message.split('\n')[0]);
  }
}

// ---- the trigger: position events for a watched leader
let pending: ReturnType<typeof setTimeout> | undefined;
function onLog(l: { data: Hex; topics: [Hex, ...Hex[]] }) {
  let id: bigint | undefined;
  try {
    const ev = decodeEventLog({ abi: positionEvents, data: l.data, topics: l.topics }) as { args: { accountId?: bigint; posAccountId?: bigint } };
    const a = ev.args;
    id = a.accountId ?? a.posAccountId;
  } catch {
    return; // not a position event (most Exchange logs are order-book traffic)
  }
  if (id === undefined || !leaders.has(id.toString())) return;
  if (pending) return;
  log(`leader #${id} moved`);
  pending = setTimeout(() => {
    pending = undefined;
    void beat(false, `event #${id}`);
  }, DEBOUNCE_MS);
}

function connect(attempt = 0) {
  const ws = new WebSocket(WS);
  ws.onopen = () => {
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['logs', { address: PERPL.exchange }] }));
    log('watching Exchange events');
    attempt = 0;
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.params?.result) onLog(m.params.result);
    else if (m.error) log('subscribe error', JSON.stringify(m.error));
  };
  ws.onclose = () => {
    if (Date.now() > END) return;
    const wait = Math.min(30_000, 1000 * 2 ** attempt);
    log(`websocket closed, reconnecting in ${wait / 1000}s`);
    setTimeout(() => connect(attempt + 1), wait);
  };
  ws.onerror = () => ws.close();
}

await refreshLeaders();
log(`heartbeat -> ${URL}, watching ${leaders.size} leader(s)`);
connect();
const timer = setInterval(() => {
  if (Date.now() > END) {
    clearInterval(timer);
    log('run window over, exiting');
    process.exit(0);
  }
  const now = Date.now();
  if (now - lastBots >= BOTS_MS) void beat(true, 'bots');
  else if (now - lastBeat >= BASE_MS) void beat(false, 'beat');
}, 1000);
setInterval(refreshLeaders, 60_000);
