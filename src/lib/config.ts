import { monadTestnet } from 'viem/chains';

/** Network constants for Monad testnet. Source: docs.perpl.xyz Networks page + docs.agora.finance deployments. */
export const chain = monadTestnet;

export const PERPL = {
  api: 'https://testnet.perpl.xyz/api',
  ws: 'wss://testnet.perpl.xyz',
  chainId: 10143,
  exchange: '0x1964C32f0bE608E7D29302AFF5E61268E72080cc',
} as const;

export const AUSD = {
  token: '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC',
  faucet: '0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C',
  decimals: 6,
} as const;

export const RP_NAME = 'Tandem';

/** Where Perpl answers 451 (seen live from a US region), so Tandem can't trade there. */
export const RESTRICTED_COUNTRIES = new Set(['US']);
