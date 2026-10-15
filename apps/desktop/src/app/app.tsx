import { useState } from "react";
import { AccountsPage } from "@/features/accounts/accounts-page";
import { useAccountsView } from "@/features/accounts/queries";
import { ComingSoonPage } from "./coming-soon";
import { pages, Shell, type PageId } from "./shell";

export function App() {
  const [page, setPage] = useState<PageId>("accounts");
  const { view } = useAccountsView();
  return (
    <Shell page={page} onNavigate={setPage} badges={{ accounts: view?.attention.length }}>
      {page === "accounts" ? <AccountsPage /> : <ComingSoonPage title={pages[page].label} />}
    </Shell>
  );
}
