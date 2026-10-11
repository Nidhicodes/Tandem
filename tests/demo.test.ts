// Demo bot tests. Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoLabels, demoLeaders, STRATEGIES } from '../src/lib/demo';

const by = (name: string) => STRATEGIES.find((s) => s.name === name)!;
const KEY = `0x${'ab'.repeat(32)}`;

test('Trend Rider follows 30-minute momentum, flat in noise', () => {
  const s = by('Trend Rider');
  assert.equal(s.signal([100, 100, 100, 100, 100, 100, 100.2]), 1);
  assert.equal(s.signal([100, 100, 100, 100, 100, 100, 99.8]), -1);
  assert.equal(s.signal([100, 100, 100, 100, 100, 100, 100.01]), 0);
});

test('Mean Reverter fades stretches from the hourly average', () => {
  const s = by('Mean Reverter');
  assert.equal(s.signal([100, 100, 100, 100, 101]), -1);
  assert.equal(s.signal([100, 100, 100, 100, 99]), 1);
  assert.equal(s.signal([100, 100, 100, 100, 100.1]), 0);
});

test('Breakout joins range breaks only', () => {
  const s = by('Breakout');
  assert.equal(s.signal([100, 101, 99, 102]), 1);
  assert.equal(s.signal([100, 101, 99, 98]), -1);
  assert.equal(s.signal([100, 101, 99, 100.5]), 0);
});

test('leader keys are deterministic, distinct, and labelled as demo', () => {
  const a = demoLeaders(KEY);
  const b = demoLeaders(KEY);
  assert.equal(a.length, STRATEGIES.length);
  assert.deepEqual(a.map((l) => l.address), b.map((l) => l.address));
  assert.equal(new Set(a.map((l) => l.address)).size, a.length);
  assert.notEqual(a[0].key, KEY);
  assert.deepEqual(demoLeaders(undefined), []);
  process.env.SPONSOR_PRIVATE_KEY = KEY;
  assert.match(demoLabels().get(a[0].address.toLowerCase())!, /^Demo bot · /);
});
