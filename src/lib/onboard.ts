'use client';
/**
 * One-tap onboarding. Each step is checked against live state first and skipped when
 * already done, so the same call resumes after a refresh or on a second device.
 */
import { AUSD } from './config';
import type { Keys } from './keys';
import { balances, depositToPerpl, exchangeAccountOf, openPerplAccount, requestAusd } from './onchain';
import { enrollApiKey } from './perpl';
import { loadVault, saveVault, type VaultData } from './vault';

const UNIT = 10n ** BigInt(AUSD.decimals);
export const MIN_PERPL_DEPOSIT = 100n * UNIT; // Perpl's account minimum
/** Trading balance a new account starts with: enough margin for visible copies (faucet gives 10,000). */
export const TRADING_DEPOSIT = 1_000n * UNIT;
const MIN_GAS = 0.05;

export type Step = 'gas' | 'ausd' | 'account' | 'fund' | 'key' | 'done';
export const STEP_LABEL: Record<Step, string> = {
  gas: 'Adding gas and test AUSD',
  ausd: 'Claiming test AUSD from the faucet',
  account: 'Opening your Perpl account',
  fund: 'Moving 1,000 AUSD in to trade',
  key: 'Creating your trade-only key',
  done: 'Ready',
};

export type Status = { exchangeId?: bigint; vault: VaultData; step: Step };

export async function status(keys: Keys): Promise<Status> {
  const [acc, vault] = await Promise.all([exchangeAccountOf(keys.account.address), loadVault(keys)]);
  const b = await balances(keys.account.address);
  if (acc) {
    // Accounts opened with Perpl's 100 AUSD minimum get topped up once, if the wallet can.
    const underfunded = acc.balance + acc.locked < TRADING_DEPOSIT / 2n && b.ausdRaw >= TRADING_DEPOSIT - MIN_PERPL_DEPOSIT;
    return { exchangeId: acc.id, vault, step: underfunded ? 'fund' : vault.perplApiKey ? 'done' : 'key' };
  }
  const step: Step = Number(b.mon) < MIN_GAS ? 'gas' : b.ausdRaw < MIN_PERPL_DEPOSIT ? 'ausd' : 'account';
  return { vault, step };
}

async function fundGas(address: string) {
  const res = await fetch('/api/gas', { method: 'POST', body: JSON.stringify({ address }) });
  if (!res.ok) throw new Error((await res.json()).error ?? `gas -> ${res.status}`);
}

/** Run every remaining step, reporting progress; returns the final status. */
export async function onboard(keys: Keys, onStep: (s: Step) => void): Promise<Status> {
  const tries: Partial<Record<Step, number>> = {};
  for (;;) {
    const s = await status(keys);
    onStep(s.step);
    if (s.step === 'done') return s;
    // A step that ran but didn't change state (e.g. faucet cooldown) must not loop forever.
    if ((tries[s.step] = (tries[s.step] ?? 0) + 1) > 3) throw new Error(`${STEP_LABEL[s.step]} didn't complete. Try again shortly.`);
    if (s.step === 'gas') await fundGas(keys.account.address);
    if (s.step === 'ausd') await requestAusd(keys.account);
    if (s.step === 'account') {
      const { ausdRaw } = await balances(keys.account.address);
      await openPerplAccount(keys.account, ausdRaw >= TRADING_DEPOSIT ? TRADING_DEPOSIT : MIN_PERPL_DEPOSIT);
    }
    if (s.step === 'fund') await depositToPerpl(keys.account, TRADING_DEPOSIT - MIN_PERPL_DEPOSIT);
    if (s.step === 'key') await saveVault(keys, { perplApiKey: await enrollApiKey(keys.account, keys.perpl) });
  }
}
