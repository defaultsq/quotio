// Projects the host's flat snapshot onto what the Accounts page renders.
// Components consume these types only; every shape assumption about the API lives here.
import type {
  Account,
  ConnectionState,
  HostStatus,
  Issue,
  Metric,
  Provider,
  ProviderId,
  RefreshRequest,
  Snapshot,
  Usage,
} from "@/lib/api/client";

/** A provider as the page shows it; an account may name a provider the host's list omits. */
export type ProviderView = {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  /** Set only for providers the host lists, the only ones a refresh request may name. */
  refreshId: ProviderId | null;
};

export type Tone = "good" | "warning" | "critical" | "neutral";

export type MetricView = {
  id: string;
  label: string;
  /** Null when the host does not report a fraction left (unknown, unlimited, a fixed limit). */
  remainingPercent: number | null;
  value: string;
  tone: Tone;
  /** The host reports the limit as used up, not merely low. */
  exhausted: boolean;
  resetsAt: Date | null;
  resetsOnDay: boolean;
  resetDescription: string | null;
  /** Length of one quota period, when the host knows it; pace needs it. */
  windowSeconds: number | null;
};

export type AttentionItem = {
  key: string;
  /** Null when the item concerns the host rather than one provider. */
  provider: ProviderView | null;
  account: Account | null;
  title: string;
  detail: string;
  severity: "error" | "warning";
  /** Present only when the host says a retry may help. */
  retry: RefreshRequest | null;
};

export type AccountView = {
  account: Account;
  usage: Usage | null;
  plan: string | null;
  stale: boolean;
  metrics: MetricView[];
  /** Why quota is missing when there are no metrics to show. */
  emptyReason: string | null;
  attention: AttentionItem | null;
  /** The provider rejected the saved login; only signing in again fixes it. */
  signInExpired: boolean;
};

export type ProviderGroup = { provider: ProviderView; accounts: AccountView[] };

export type AccountsView = {
  groups: ProviderGroup[];
  attention: AttentionItem[];
  accountCount: number;
  lastUpdated: Date | null;
  unconnected: ProviderView[];
  /** Whether this host keeps quota history, and why not when it can't. */
  history: { readable: boolean; writable: boolean; reason: string | null };
  /** Why "Add account" can't work right now, or null when it can. */
  addAccountBlocked: string | null;
};

// The host serves only logins found on this computer when no Secret Service holds its vault key.
const LOCKED_STORAGE: AttentionItem = {
  key: "host:account-storage",
  provider: null,
  account: null,
  title: "Saved accounts are locked",
  detail: "Saving accounts needs a Secret Service such as GNOME Keyring or KWallet. Logins found on this computer still work.",
  severity: "warning",
  retry: null,
};

export function projectAccounts(snapshot: Snapshot, providers: Provider[], status: HostStatus): AccountsView {
  const usageByAccount = new Map(snapshot.usage.map((usage) => [usage.account_id, usage]));
  const providerById = new Map<string, ProviderView>(providers.map((provider) => [provider.id, providerView(provider)]));
  const providerFor = (id: string): ProviderView =>
    providerById.get(id) ?? { id, name: id, description: "", icon: null, refreshId: null };
  // Not Map.groupBy: older WebKitGTK builds on Linux lack it.
  const accountsByProvider = new Map<string, Account[]>();
  for (const account of snapshot.accounts) {
    accountsByProvider.set(account.provider_id, [...(accountsByProvider.get(account.provider_id) ?? []), account]);
  }

  const groups: ProviderGroup[] = [];
  const attention: AttentionItem[] = status.account_storage_enabled ? [] : [LOCKED_STORAGE];
  for (const [providerId, issue] of Object.entries(snapshot.provider_issues ?? {})) {
    attention.push(providerAttention(providerFor(providerId), issue));
  }
  // Server order for listed providers, then any account whose provider the list omits.
  const order: string[] = [...providers.map((provider) => provider.id), ...accountsByProvider.keys()];
  for (const providerId of new Set(order)) {
    const accounts = accountsByProvider.get(providerId);
    if (!accounts) continue;
    const provider = providerFor(providerId);
    const views = accounts.map((account) => accountView(account, provider, usageByAccount.get(account.id) ?? null));
    attention.push(...views.flatMap((view) => (view.attention ? [view.attention] : [])));
    groups.push({ provider, accounts: views });
  }

  const fetched = snapshot.usage.flatMap((usage) => (usage.fetched_at ? [Date.parse(usage.fetched_at)] : []));
  // A refresh that found no quota still completed; the host's clock says when.
  const completed = status.last_completed_at ? new Date(status.last_completed_at) : null;
  return {
    groups,
    attention,
    accountCount: snapshot.accounts.length,
    lastUpdated: fetched.length > 0 ? new Date(Math.max(...fetched)) : completed,
    unconnected: providers.filter((provider) => !accountsByProvider.has(provider.id)).map(providerView),
    history: {
      readable: snapshot.host.capabilities.quota_history?.available ?? false,
      writable: snapshot.host.capabilities.quota_history_write?.available ?? false,
      reason: snapshot.host.capabilities.quota_history_write?.reason ?? snapshot.host.capabilities.quota_history?.reason ?? null,
    },
    addAccountBlocked: status.account_storage_enabled ? null : LOCKED_STORAGE.detail,
  };
}

/** Keeps groups and accounts whose name, identity, plan or provider match every word of the query. */
export function filterGroups(groups: ProviderGroup[], query: string): ProviderGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return groups;
  return groups.flatMap((group) => {
    const accounts = group.accounts.filter((view) => {
      const haystack = [
        view.account.display_name,
        view.account.identity.email,
        view.account.identity.username,
        view.plan,
        group.provider.name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
    return accounts.length > 0 ? [{ ...group, accounts }] : [];
  });
}

function providerView(provider: Provider): ProviderView {
  return {
    id: provider.id,
    name: provider.display_name,
    description: provider.description,
    icon: provider.icon,
    refreshId: provider.id,
  };
}

function accountView(account: Account, provider: ProviderView, usage: Usage | null): AccountView {
  const metrics = usage?.metrics.map(metricView) ?? [];
  return {
    account,
    usage,
    plan: usage?.plan ?? null,
    stale: usage?.freshness === "stale",
    metrics,
    emptyReason: metrics.length > 0 ? null : emptyReason(account, usage),
    attention: accountAttention(account, provider, usage),
    signInExpired: account.state === "needs_login" || accountIssue(account, usage)?.code === "authentication",
  };
}

function emptyReason(account: Account, usage: Usage | null): string {
  if (!account.enabled || account.state === "disabled") return "Turned off";
  switch (usage?.freshness) {
    case undefined:
    case "not_loaded":
      return "Waiting for the first refresh";
    case "unavailable":
      return "Quota unavailable";
    default:
      return "No quota reported";
  }
}

function metricView(metric: Metric): MetricView {
  const base = {
    id: metric.id,
    label: metric.display_name,
    resetsAt: metric.resets_at ? new Date(metric.resets_at) : null,
    resetsOnDay: metric.reset_precision === "day",
    resetDescription: metric.reset_description,
    windowSeconds: metric.window_seconds ?? null,
    exhausted: metric.quota.state === "exhausted",
  };
  const quota = metric.quota;
  switch (quota.state) {
    case "available":
    case "exhausted": {
      const remaining = quota.remaining_percent;
      return { ...base, remainingPercent: remaining, value: `${Math.round(remaining)}%`, tone: toneFor(remaining) };
    }
    case "limit":
      return {
        ...base,
        remainingPercent: null,
        value: metric.amounts
          ? `${formatAmount(metric.amounts.remaining)} of ${formatAmount(quota.amount)} ${quota.unit}`
          : `${formatAmount(quota.amount)} ${quota.unit}`,
        tone: "neutral",
      };
    case "unlimited":
      return { ...base, remainingPercent: null, value: "Unlimited", tone: "good" };
    case "disabled":
      return { ...base, remainingPercent: null, value: "Off", tone: "neutral" };
    case "unknown":
      return { ...base, remainingPercent: null, value: "Unknown", tone: "neutral" };
  }
}

function toneFor(remainingPercent: number): Tone {
  if (remainingPercent < 20) return "critical";
  if (remainingPercent < 50) return "warning";
  return "good";
}

function formatAmount(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

const STATES_NEEDING_ACTION: ReadonlySet<ConnectionState> = new Set(["needs_login", "needs_authorization", "unavailable"]);

function accountAttention(account: Account, provider: ProviderView, usage: Usage | null): AttentionItem | null {
  const issue = accountIssue(account, usage);
  if (!issue && !STATES_NEEDING_ACTION.has(account.state)) return null;
  return {
    key: `account:${account.id}`,
    provider,
    account,
    ...(issue ? issueCopy(issue.code, provider) : stateCopy(account.state, provider)),
    retry:
      issue?.retryable && provider.refreshId
        ? { providers: [provider.refreshId], account_id: account.id, force: true }
        : null,
  };
}

function accountIssue(account: Account, usage: Usage | null): Issue | null {
  return usage?.issue ?? account.sources.find((source) => source.issue)?.issue ?? null;
}

function providerAttention(provider: ProviderView, issue: Issue): AttentionItem {
  return {
    key: `provider:${provider.id}`,
    provider,
    account: null,
    ...issueCopy(issue.code, provider),
    retry: issue.retryable && provider.refreshId ? { providers: [provider.refreshId], force: true } : null,
  };
}

type Copy = Pick<AttentionItem, "title" | "detail" | "severity">;

// Issue codes are the host's ProviderError values (apps/cli/src/error.rs).
function issueCopy(code: string, provider: ProviderView): Copy {
  const name = provider.name;
  switch (code) {
    case "authentication":
      return { title: "Sign-in expired", detail: `Quota is no longer updating. Sign in to ${name} again.`, severity: "error" };
    case "owner_refresh_required":
      return { title: `Open ${name} to sign in again`, detail: `${name} must refresh its own login before Quotio can read quota.`, severity: "error" };
    case "local_credential_storage":
      return { title: `Allow access to the ${name} login`, detail: `Quotio found a ${name} login but can’t read it yet.`, severity: "warning" };
    case "credential_storage":
      return { title: "Saved accounts are locked", detail: "Quotio can’t open its saved account storage.", severity: "error" };
    case "timeout":
    case "transient":
    case "cancelled":
      return { title: `${name} quota couldn’t be refreshed`, detail: "The last refresh failed. Retrying won’t sign you out.", severity: "warning" };
    case "rate_limited":
      return { title: `${name} is rate limiting Quotio`, detail: "Quota will refresh again shortly.", severity: "warning" };
    case "cli_not_found":
      return { title: `${name} tool not found`, detail: `Install ${name} or add it to your PATH.`, severity: "warning" };
    case "quota_unavailable":
      return { title: `${name} quota couldn’t be verified`, detail: "You’re signed in, but the provider didn’t report quota.", severity: "warning" };
    case "unavailable":
      return { title: `${name} is unavailable`, detail: "A required local tool or service isn’t responding.", severity: "warning" };
    default:
      return { title: `${name} couldn’t be read`, detail: `The host reported “${code.replaceAll("_", " ")}”.`, severity: "error" };
  }
}

function stateCopy(state: ConnectionState, provider: ProviderView): Copy {
  switch (state) {
    case "needs_login":
      return issueCopy("authentication", provider);
    case "needs_authorization":
      return issueCopy("local_credential_storage", provider);
    default:
      return issueCopy("unavailable", provider);
  }
}
