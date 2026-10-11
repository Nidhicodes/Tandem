// Always-on engine, local runner.
//   npm run engine         run a copy pass for every active agent every 15s
//   npm run engine:token   print the bearer token the CRE workflow uses for /api/engine/tick
import { tick, tickToken } from '../src/lib/agent-engine';

if (process.argv[2] === 'token') {
  console.log(tickToken());
} else {
  for (;;) {
    const started = Date.now();
    try {
      const reports = await tick();
      for (const r of reports) {
        for (const l of r.logs) console.log(new Date(l.at).toISOString(), r.owner, `#${r.leader}`, l.level, l.text);
        if (r.error) console.log(new Date().toISOString(), r.owner, 'error', r.error);
      }
      if (!reports.length) console.log(new Date().toISOString(), 'no active agents');
    } catch (e) {
      console.log(new Date().toISOString(), 'tick failed', (e as Error).message.split('\n')[0]);
    }
    await new Promise((r) => setTimeout(r, Math.max(0, 15_000 - (Date.now() - started))));
  }
}
