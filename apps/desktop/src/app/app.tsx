import { useEffect, useState, type ComponentType } from "react";
import { AccountsPage } from "@/features/accounts/accounts-page";
import type { AccountsView } from "@/features/accounts/model";
import { useAccountsView, useRefresh } from "@/features/accounts/queries";
import { useQuotaAlerts } from "@/features/alerts/use-alerts";
import { HistorySheet, type HistoryTarget } from "@/features/history/history-sheet";
import { OpenHistoryContext } from "@/features/history/open-history";
import { OnboardingDialog } from "@/features/onboarding/onboarding-dialog";
import { AboutPage } from "@/features/settings/about-page";
import { GeneralPage } from "@/features/settings/general-page";
import { NotificationsPage } from "@/features/settings/notifications-page";
import { PrivacyPage } from "@/features/settings/privacy-page";
import { SharingPage } from "@/features/sharing/sharing-page";
import { TrayPage } from "@/features/tray/tray-page";
import { useTrayTooltip } from "@/features/tray/use-tray-tooltip";
import { onMainRequest, onTrayRefresh } from "@/lib/desktop";
import { ComingSoonPage } from "./coming-soon";
import { pages, Shell, type PageId } from "./shell";

const screens: Partial<Record<PageId, ComponentType>> = {
  accounts: AccountsPage,
  iphone: SharingPage,
  general: GeneralPage,
  tray: TrayPage,
  notifications: NotificationsPage,
  privacy: PrivacyPage,
  about: AboutPage,
};

/** The main window. It lives for the whole session (closing only hides it), so it also drives the tray and alerts. */
export function App() {
  const [page, setPage] = useState<PageId>("accounts");
  // Bumped by the tray's "Pair iPhone…"; remounting the page opens its pairing dialog. Zero once the user navigates.
  const [pairRequest, setPairRequest] = useState(0);
  const [historyAccount, setHistoryAccount] = useState<string | null>(null);
  const { view } = useAccountsView();
  const { mutate: refresh } = useRefresh();
  useTrayTooltip(view);
  useQuotaAlerts(view);

  useEffect(() => {
    const listeners = [
      onMainRequest((request) => {
        switch (request.kind) {
          case "accounts":
            setPage("accounts");
            break;
          case "pair-iphone":
            setPage("iphone");
            setPairRequest((count) => count + 1);
            break;
          case "history":
            setHistoryAccount(request.accountId);
            break;
        }
      }),
      onTrayRefresh(() => refresh({ force: true })),
    ];
    return () => listeners.forEach((listener) => void listener.then((stop) => stop()));
  }, [refresh]);

  const Screen = screens[page];
  return (
    <OpenHistoryContext.Provider value={setHistoryAccount}>
      <Shell
        page={page}
        onNavigate={(next) => {
          setPairRequest(0);
          setPage(next);
        }}
        badges={{ accounts: view?.attention.length }}
      >
        {page === "iphone" && pairRequest > 0 ? (
          <SharingPage key={pairRequest} pairOnOpen />
        ) : Screen ? (
          <Screen />
        ) : (
          <ComingSoonPage title={pages[page].label} />
        )}
      </Shell>
      <HistorySheet target={historyTarget(view, historyAccount)} onClose={() => setHistoryAccount(null)} />
      <OnboardingDialog />
    </OpenHistoryContext.Provider>
  );
}

function historyTarget(view: AccountsView | undefined, accountId: string | null): HistoryTarget | null {
  if (!view || !accountId) return null;
  for (const group of view.groups) {
    const account = group.accounts.find((candidate) => candidate.account.id === accountId);
    if (account) return { provider: group.provider, account };
  }
  return null;
}
