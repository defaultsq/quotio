import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex w-full items-start gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 className="text-sm leading-5 font-medium tracking-[-0.084px] text-text-strong-950">{title}</h1>
        {subtitle && <p className="text-sm leading-5 font-medium tracking-[-0.084px] text-text-soft-400">{subtitle}</p>}
      </div>
      {children}
    </header>
  );
}
