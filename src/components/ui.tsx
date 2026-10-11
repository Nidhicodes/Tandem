export const Card = ({ children, title }: { children: React.ReactNode; title?: string }) => (
  <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
    {title && <h2 className="mb-2 text-sm font-medium text-[var(--muted)]">{title}</h2>}
    {children}
  </section>
);

export const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex justify-between gap-3 py-1 text-sm">
    <span className="text-[var(--muted)]">{k}</span>
    <span className="font-mono">{v}</span>
  </div>
);

export function Button({ children, onClick, busy, disabled, variant = 'solid' }: {
  children: React.ReactNode; onClick: () => void; busy?: string; disabled?: boolean; variant?: 'solid' | 'ghost';
}) {
  const base = 'w-full rounded-xl px-4 py-3 font-medium transition disabled:opacity-40';
  const look = variant === 'solid' ? 'bg-[var(--accent)] text-white' : 'border border-[var(--line)] bg-transparent text-[var(--text)]';
  return (
    <button type="button" className={`${base} ${look}`} onClick={onClick} disabled={!!busy || disabled} aria-busy={!!busy}>
      {busy ?? children}
    </button>
  );
}

export const ErrorLine = ({ error }: { error?: string }) =>
  error ? <p role="alert" className="break-words text-sm text-red-400">{error}</p> : null;

export function Field({ label, value, onChange, suffix }: { label: string; value: number; onChange: (v: number) => void; suffix: string }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-24 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-right font-mono text-[var(--text)]"
        />
        <span className="w-10 text-[var(--muted)]">{suffix}</span>
      </span>
    </label>
  );
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
