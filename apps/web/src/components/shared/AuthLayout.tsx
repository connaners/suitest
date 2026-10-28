import type React from "react";

export function AuthContainer({ children }: { children: React.ReactNode }): React.ReactElement {
  return <section className="mx-auto max-w-md space-y-6 pt-16">{children}</section>;
}

export function AuthHeader({ subtitle }: { subtitle?: React.ReactNode }): React.ReactElement {
  return (
    <div className="space-y-3 text-center">
      <img src="/logo.svg" alt="Suitest" className="mx-auto h-12 w-12 rounded-xl" />
      <h2 className="font-mono text-2xl font-semibold tracking-tight">
        sui<span className="text-accent">test</span>
      </h2>
      {subtitle ? <p className="text-[13px] text-fg-3">{subtitle}</p> : null}
    </div>
  );
}

export function AuthSubmitButton({
  submitting,
  label,
  loadingLabel,
}: {
  submitting: boolean;
  label: string;
  loadingLabel: string;
}): React.ReactElement {
  return (
    <button
      type="submit"
      disabled={submitting}
      className="inline-flex w-full items-center justify-center rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-accent-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {submitting ? loadingLabel : label}
    </button>
  );
}

export function AuthFooter(): React.ReactElement {
  return (
    <p className="pt-4 text-center text-[11px] text-fg-5">
      © 2026 Suitest contributors · Apache-2.0 · open source
    </p>
  );
}
