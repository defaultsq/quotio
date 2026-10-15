import type { ReactNode } from "react";
import {
  RiGroupLine,
  RiInformationLine,
  RiLayoutBottomLine,
  RiNotification3Line,
  RiServerLine,
  RiSettings3Line,
  RiShieldKeyholeLine,
  RiSmartphoneLine,
  type RemixiconComponentType,
} from "@remixicon/react";
import { cn } from "@/lib/utils";

export const pages = {
  accounts: { label: "Accounts", icon: RiGroupLine },
  iphone: { label: "iPhone Sharing", icon: RiSmartphoneLine },
  cliproxy: { label: "CLIProxyAPI", icon: RiServerLine },
  general: { label: "General", icon: RiSettings3Line },
  tray: { label: "Tray", icon: RiLayoutBottomLine },
  notifications: { label: "Notifications", icon: RiNotification3Line },
  privacy: { label: "Privacy", icon: RiShieldKeyholeLine },
  about: { label: "About & Updates", icon: RiInformationLine },
} satisfies Record<string, { label: string; icon: RemixiconComponentType }>;

export type PageId = keyof typeof pages;

const sections: { title?: string; items: PageId[]; footer?: boolean }[] = [
  { items: ["accounts", "iphone", "cliproxy"] },
  { title: "Application", items: ["general", "tray", "notifications", "privacy"] },
  { items: ["about"], footer: true },
];

type ShellProps = {
  page: PageId;
  onNavigate: (page: PageId) => void;
  badges: Partial<Record<PageId, number>>;
  children: ReactNode;
};

export function Shell({ page, onNavigate, badges, children }: ShellProps) {
  return (
    <div className="flex h-full gap-1.5 bg-bg-weak-50 p-1.5">
      <nav className="flex w-[240px] shrink-0 flex-col gap-4 p-3.5">
        {sections.map((section, index) => (
          <div key={index} className={cn("flex flex-col gap-1", section.footer && "mt-auto")}>
            {section.title && (
              <div className="flex h-6 items-center px-2 text-xs font-medium text-text-soft-400">{section.title}</div>
            )}
            {section.items.map((id) => (
              <NavItem key={id} id={id} active={id === page} badge={badges[id]} onSelect={() => onNavigate(id)} />
            ))}
          </div>
        ))}
      </nav>
      <main className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto rounded-3xl bg-bg-white-0 px-7 pt-[22px] pb-7 shadow-card">
        {children}
      </main>
    </div>
  );
}

function NavItem({ id, active, badge, onSelect }: { id: PageId; active: boolean; badge?: number; onSelect: () => void }) {
  const { label, icon: Icon } = pages[id];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-[10px] p-2 text-left text-sm leading-5 font-medium tracking-[-0.084px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active ? "bg-bg-white-0 text-text-strong-950 shadow-raised" : "text-text-sub-600 hover:bg-bg-white-0/60",
      )}
    >
      <Icon className={cn("size-5 shrink-0", active ? "text-primary-base" : "text-text-sub-600")} />
      <span className="flex-1">{label}</span>
      {badge ? (
        <span className="flex min-w-[18px] justify-center rounded-[5px] bg-alpha-red-10 px-1.5 py-0.5 text-[11px] font-semibold text-state-error">
          {badge}
        </span>
      ) : null}
    </button>
  );
}
