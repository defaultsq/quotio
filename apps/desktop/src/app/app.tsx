import { useState, type ComponentType } from "react";
import { AccountsPage } from "@/features/accounts/accounts-page";
import { useAccountsView } from "@/features/accounts/queries";
import { AboutPage } from "@/features/settings/about-page";
import { GeneralPage } from "@/features/settings/general-page";
import { NotificationsPage } from "@/features/settings/notifications-page";
import { PrivacyPage } from "@/features/settings/privacy-page";
import { SharingPage } from "@/features/sharing/sharing-page";
import { ComingSoonPage } from "./coming-soon";
import { pages, Shell, type PageId } from "./shell";

const screens: Partial<Record<PageId, ComponentType>> = {
  accounts: AccountsPage,
  iphone: SharingPage,
  general: GeneralPage,
  notifications: NotificationsPage,
  privacy: PrivacyPage,
  about: AboutPage,
};

export function App() {
  const [page, setPage] = useState<PageId>("accounts");
  const { view } = useAccountsView();
  const Screen = screens[page];
  return (
    <Shell page={page} onNavigate={setPage} badges={{ accounts: view?.attention.length }}>
      {Screen ? <Screen /> : <ComingSoonPage title={pages[page].label} />}
    </Shell>
  );
}
