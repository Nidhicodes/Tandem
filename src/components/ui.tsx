export const Card = ({ children, title, action }: { children: React.ReactNode; title?: string; action?: React.ReactNode }) => (
  <section className="rounded-3xl border border-[var(--line)] bg-[var(--card)]/90 p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset] backdrop-blur">
    {(title || action) && (
      <div className="mb-3 flex items-center justify-between">
        {title && <h2 className="text-sm font-medium text-[var(--muted)]">{title}</h2>}
        {action}
      </div>
    )}
    {children}
  </section>
);

export const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex justify-between gap-3 py-1.5 text-sm">
    <span className="text-[var(--muted)]">{k}</span>
    <span className="font-mono">{v}</span>
  </div>
);

export function Button({ children, onClick, busy, disabled, variant = 'solid' }: {
  children: React.ReactNode; onClick: () => void; busy?: string; disabled?: boolean; variant?: 'solid' | 'ghost';
}) {
  const base = 'flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-base font-semibold transition active:scale-[0.98] disabled:opacity-40 motion-reduce:transition-none';
  const look = variant === 'solid' ? 'brand-gradient text-white shadow-lg shadow-[var(--accent)]/25' : 'border border-[var(--line)] bg-[var(--card)] text-[var(--text)]';
  return (
    <button type="button" className={`${base} ${look}`} onClick={onClick} disabled={!!busy || disabled} aria-busy={!!busy}>
      {busy && <Spinner />}
      {busy ?? children}
    </button>
  );
}

export const Spinner = () => (
  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" aria-hidden />
);

export const ErrorLine = ({ error }: { error?: string }) =>
  error ? <p role="alert" className="break-words rounded-2xl border border-[var(--down)]/30 bg-[var(--down)]/10 px-3 py-2 text-sm text-[var(--down)]">{error}</p> : null;

export function Field({ label, value, onChange, suffix }: { label: string; value: number; onChange: (v: number) => void; suffix: string }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-10 w-24 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-right font-mono text-base text-[var(--text)]"
        />
        <span className="w-10 text-[var(--muted)]">{suffix}</span>
      </span>
    </label>
  );
}

/** A deterministic two-color avatar for an address, so traders are recognisable at a glance. */
export function Avatar({ address, size = 36 }: { address: string; size?: number }) {
  const h = parseInt(address.slice(2, 8), 16);
  const a = h % 360;
  const b = (a + 60 + ((h >> 8) % 120)) % 360;
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${a} 80% 60%), hsl(${b} 80% 45%))` }}
    />
  );
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const pnlClass = (v: number | bigint) => (v >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]');
