import type { ReactNode } from "react";
import type { RemixiconComponentType } from "@remixicon/react";
import { cn } from "@/lib/utils";

export function SettingsHeader({ title, subtitle, children }: { title: string; subtitle: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex w-full items-end gap-4 border-b border-stroke-soft-200 pb-5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 className="text-lg leading-7 font-semibold tracking-[-0.27px] text-text-strong-950">{title}</h1>
        <p className="text-sm leading-5 text-text-sub-600">{subtitle}</p>
      </div>
      {children}
    </header>
  );
}

/** A titled band of settings: intro on the left, content on the right, divided from the next band. */
export function SettingsSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className="flex gap-8 border-b border-stroke-soft-200 pb-6 last:border-b-0 last:pb-0">
      <div className="flex w-[220px] shrink-0 flex-col gap-1">
        <h2 className="text-sm leading-5 font-medium text-text-strong-950">{title}</h2>
        {description && <p className="text-xs leading-normal text-text-sub-600">{description}</p>}
      </div>
      <div className={cn("flex min-w-0 flex-1 flex-col", className)}>{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  help,
  icon,
  children,
  className,
}: {
  label: ReactNode;
  help?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-4 border-t border-stroke-soft-200 py-3 first:border-t-0", icon && "gap-3", className)}>
      {icon}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="text-sm leading-5 font-medium text-text-strong-950">{label}</div>
        {help && <div className="text-xs leading-4 text-text-sub-600">{help}</div>}
      </div>
      {children}
    </div>
  );
}

export type IconTone = "neutral" | "primary" | "warning" | "error" | "raised";

const toneClass: Record<IconTone, string> = {
  neutral: "bg-bg-weak-50 text-text-sub-600",
  primary: "bg-alpha-primary-10 text-primary-base",
  warning: "bg-alpha-away-10 text-state-away",
  error: "bg-alpha-red-10 text-state-error",
  raised: "bg-bg-white-0 text-text-sub-600 shadow-raised",
};

export function IconTile({ icon: Icon, tone = "neutral" }: { icon: RemixiconComponentType; tone?: IconTone }) {
  return (
    <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-[10px]", toneClass[tone])}>
      <Icon className="size-4" />
    </div>
  );
}
