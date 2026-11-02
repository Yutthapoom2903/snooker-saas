'use client';
import { forwardRef, useEffect, useRef } from 'react';

type Variant = 'primary' | 'quiet' | 'danger' | 'outline';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-baize text-white hover:bg-baize-deep active:bg-baize-deep',
  outline: 'border border-line bg-white text-ink hover:border-felt hover:text-baize',
  quiet: 'text-baize hover:bg-mist',
  danger: 'border border-ball-red/30 bg-white text-ball-red hover:bg-ball-red hover:text-white',
};

export const Button = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean; size?: 'sm' | 'md' | 'lg' }>(
  function Button({ variant = 'primary', busy, size = 'md', className = '', children, disabled, ...rest }, ref) {
    const pad = size === 'sm' ? 'px-3 py-1.5 text-sm' : size === 'lg' ? 'px-5 py-3 text-base' : 'px-4 py-2 text-sm';
    return (
      <button
        ref={ref}
        disabled={disabled || busy}
        className={`press inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${pad} ${VARIANT[variant]} ${className}`}
        {...rest}
      >
        {busy && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />}
        {children}
      </button>
    );
  },
);

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-mute">{hint}</span>}
    </label>
  );
}

const TONE = {
  green: 'bg-mist text-baize',
  yellow: 'bg-[#fbf1dc] text-[#8a6210]',
  red: 'bg-[#f8e3e1] text-ball-red',
  gray: 'bg-[#eef1ef] text-ink-mute',
};
export function Badge({ tone = 'gray', children }: { tone?: keyof typeof TONE; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONE[tone]}`}>{children}</span>;
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-ink-soft">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-soft">{children}</div>}
    </div>
  );
}

/** Native <dialog>: focus trap, Esc and backdrop for free. */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`modal m-auto w-[calc(100%-2rem)] rounded-2xl bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/40 ${wide ? 'max-w-2xl' : 'max-w-md'}`}
    >
      {open && (
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button onClick={onClose} className="-m-1 rounded-md p-1 text-ink-mute hover:text-ink" aria-label="ปิด">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 5l10 10M15 5L5 15" /></svg>
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm select-none">
      <span className={`relative h-5 w-9 rounded-full transition-colors duration-200 ${checked ? 'bg-felt' : 'bg-mist-2'}`}>
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-4' : ''}`} />
      </span>
      {label}
    </label>
  );
}

/** Shop logo, or a monogram disc in baize when the shop hasn't uploaded one. */
export function ShopMark({ name, logoUrl, size = 40 }: { name: string; logoUrl?: string | null; size?: number }) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt={name} width={size} height={size} className="shrink-0 rounded-full bg-white object-cover" style={{ width: size, height: size }} />;
  }
  const initials = name.replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <span className="num inline-flex shrink-0 items-center justify-center rounded-full bg-baize font-semibold text-white" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
      {initials || 'S'}
    </span>
  );
}
