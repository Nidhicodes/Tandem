import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Tandem',
    short_name: 'Tandem',
    description: 'Trade in tandem with the best perp traders. One passkey, no seed phrase.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b0d12',
    theme_color: '#0b0d12',
  };
}
