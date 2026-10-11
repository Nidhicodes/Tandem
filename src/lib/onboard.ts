'use client';
/**
 * One-tap onboarding. Each step is checked against live state first and skipped when
 * already done, so the same call resumes after a refresh or on a second device.
 */
import { AUSD } from './config';
import type { Keys } from './keys';
import { balances, exchangeAccountOf, openPerplAccount, requestAusd } from './onchain';
import { enrollApiKey } from './perpl';
import { loadVault, saveVault, type VaultData } from './vault';

export const MIN_PERPL_DEPOSIT = 100n * 10n ** BigInt(AUSD.decimals); // Perpl's account minimum
const MIN_GAS = 0.05;

export type Step = 'gas' | 'ausd' | 'account' | 'key' | 'done';
export const STEP_LABEL: Record<Step, string> = {
  gas: 'Adding gas to your account',
  ausd: 'Claiming test AUSD',
  account: 'Opening your Perpl account',
  key: 'Creating your trade-only key',
  done: 'Ready',
};

export type Status = { exchangeId?: bigint; vault: VaultData; step: Step };

export async function status(keys: Keys): Promise<Status> {
  const [acc, vault] = await Promise.all([exchangeAccountOf(keys.account.address), loadVault(keys)]);
  if (acc && vault.perplApiKey) return { exchangeId: acc.id, vault, step: 'done' };
  if (acc) return { exchangeId: acc.id, vault, step: 'key' };
  const b = await balances(keys.account.address);
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
    if (s.step === 'account') await openPerplAccount(keys.account, MIN_PERPL_DEPOSIT);
    if (s.step === 'key') await saveVault(keys, { perplApiKey: await enrollApiKey(keys.account, keys.perpl) });
  }
}
