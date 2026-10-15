import { useState } from "react";
import {
  RiCheckLine,
  RiDownloadCloud2Line,
  RiExternalLinkLine,
  RiFileCopyLine,
  RiKey2Line,
  RiPlayLine,
  RiRestartLine,
  RiServerLine,
  RiStackLine,
  RiStopCircleLine,
} from "@remixicon/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { IconTile, SettingsHeader, SettingsRow, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { isPort, updatePreferences, usePreferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import {
  availableUpdate,
  compareVersions,
  dashboardUrl,
  formatDate,
  projectJob,
  projectServer,
  projectVersions,
  type JobView,
  type ProxyStatus,
  type ServerTone,
  type ServerView,
} from "./model";
import { copyManagementKey, useProxyCommand, useProxyReleases, useProxyStatus, useSetProxyPort } from "./queries";

export function ProxyPage() {
  const status = useProxyStatus();
  return (
    <>
      <SettingsHeader title="CLIProxyAPI" subtitle="An optional local proxy for your AI tools. Quota monitoring works without it." />
      {status.data ? (
        <>
          <ServerCard status={status.data} />
          <ConfigurationSection />
          {status.data.active && <VersionSection status={status.data} />}
        </>
      ) : status.error ? (
        <p className="text-sm text-state-error">Couldn’t read the proxy status. {status.error.message}</p>
      ) : (
        <Skeleton className="h-[132px] w-full rounded-2xl" />
      )}
    </>
  );
}

function ServerCard({ status }: { status: ProxyStatus }) {
  const view = projectServer(status);
  return view.kind === "not_installed" ? <InstallCard job={view.job} /> : <InstalledCard view={view} apiKey={status.api_key} />;
}

function InstallCard({ job }: { job: JobView | null }) {
  const releases = useProxyReleases();
  const command = useProxyCommand();
  const latest = releases.data?.[0];
  const error = command.error ?? releases.error;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-stroke-soft-200 px-5 py-4">
      <div className="flex items-center gap-4">
        <IconTile icon={RiServerLine} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-base leading-6 font-semibold text-text-strong-950">{job ? job.title : "Not installed"}</span>
          <span className={cn("text-xs leading-4 break-words", error ? "text-state-error" : "text-text-sub-600")}>
            {error
              ? error.message
              : job
                ? job.detail
                : "Quotio downloads CLIProxyAPI from its GitHub releases and runs it on this computer."}
          </span>
        </div>
        <Button
          variant="inverse"
          disabled={!latest || command.isPending}
          onClick={() => latest && command.mutate({ kind: "install", version: latest.version, start: true })}
          className="h-9 rounded-[10px] px-3.5"
        >
          <RiDownloadCloud2Line />
          {command.isPending ? "Installing…" : latest ? `Install v${latest.version}` : "Install"}
        </Button>
      </div>
      {job?.percent != null && <Progress percent={job.percent} />}
    </div>
  );
}

/** The download or trial run in progress. */
function JobRow({ job }: { job: JobView }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-bg-weak-50 px-4 py-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm leading-5 font-medium text-text-strong-950">{job.title}</span>
        <span className="text-xs leading-4 text-text-sub-600">{job.detail}</span>
      </div>
      {job.percent != null && <Progress percent={job.percent} />}
    </div>
  );
}

function Progress({ percent }: { percent: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-weak-50" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-primary-base transition-[width]" style={{ width: `${percent}%` }} />
    </div>
  );
}

const toneClass: Record<ServerTone, { tile: string; dot: string }> = {
  running: { tile: "bg-alpha-primary-10", dot: "bg-primary-base shadow-[0_0_0_4px_var(--color-alpha-primary-10)]" },
  busy: { tile: "bg-alpha-away-10", dot: "animate-pulse bg-state-away" },
  stopped: { tile: "bg-bg-weak-50", dot: "bg-text-soft-400" },
  failed: { tile: "bg-alpha-red-10", dot: "bg-state-error" },
};

function InstalledCard({ view, apiKey }: { view: Extract<ServerView, { kind: "installed" }>; apiKey: string | null }) {
  const command = useProxyCommand();
  const pending = command.isPending;
  const { tile, dot } = toneClass[view.tone];
  return (
    <div className="flex flex-col">
      <div className="flex flex-col overflow-clip rounded-2xl border border-stroke-soft-200">
        <div className="flex items-center gap-4 px-5 py-4">
          <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", tile)}>
            <div className={cn("size-2.5 rounded-full", dot)} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-base leading-6 font-semibold text-text-strong-950">{view.title}</span>
            <span className={cn("text-xs leading-4 break-words", view.tone === "failed" ? "text-state-error" : "text-text-sub-600")}>
              {view.detail}
            </span>
          </div>
          {view.canStop && (
            <Button variant="raised" disabled={pending} onClick={() => command.mutate({ kind: "restart" })} className="h-9 rounded-[10px] px-3 text-text-strong-950">
              <RiRestartLine />
              Restart
            </Button>
          )}
          {view.canStop && (
            <Button variant="raised" disabled={pending} onClick={() => command.mutate({ kind: "stop" })} className="h-9 rounded-[10px] px-3 text-state-error hover:text-state-error">
              <RiStopCircleLine />
              Stop
            </Button>
          )}
          {view.canStart && (
            <Button variant="inverse" disabled={pending} onClick={() => command.mutate({ kind: "start" })} className="h-9 rounded-[10px] px-3.5">
              <RiPlayLine />
              Start
            </Button>
          )}
        </div>
        {view.endpoint && <EndpointRow url={view.endpoint.url} port={view.endpoint.port} apiKey={apiKey} />}
      </div>
      {command.error && view.tone !== "failed" && <p className="pt-2 text-xs text-state-error">{command.error.message}</p>}
    </div>
  );
}

function EndpointRow({ url, port, apiKey }: { url: string; port: number; apiKey: string | null }) {
  const [note, setNote] = useState<string | null>(null);
  const openDashboard = () =>
    copyManagementKey()
      .then(() => setNote("Management key copied. Paste it into the dashboard to sign in."))
      .catch(() => setNote(null))
      .then(() => openUrl(dashboardUrl(port)))
      .catch((error) => setNote(`Couldn’t open the dashboard. ${String(error)}`));
  return (
    <div className="flex flex-col gap-2 border-t border-stroke-soft-200 bg-bg-weak-50 px-5 py-3.5">
      <div className="flex items-center gap-3">
        <span className="text-xs leading-4 font-medium tracking-[0.48px] text-text-soft-400 uppercase">Endpoint</span>
        <span className="flex-1 truncate font-mono text-sm leading-5 text-text-strong-950">{url}</span>
        <CopyButton text={url} label="Copy endpoint" />
        {apiKey && <CopyButton text={apiKey} label="Copy API key" icon={RiKey2Line} />}
        <Button variant="inverse" size="sm" onClick={openDashboard} className="rounded-[9px]">
          Open dashboard
          <RiExternalLinkLine className="size-3.5" />
        </Button>
      </div>
      {note && <p className="text-xs leading-4 text-text-sub-600">{note}</p>}
    </div>
  );
}

/** Icon-only copies the text; with `icon` it is a labelled button, as the API key's is. */
function CopyButton({ text, label, icon: Icon }: { text: string; label: string; icon?: typeof RiKey2Line }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard.writeText(text).then(() => setCopied(true));
  const glyph = copied ? <RiCheckLine className="size-3.5" /> : Icon ? <Icon className="size-3.5" /> : <RiFileCopyLine className="size-3.5" />;
  return Icon ? (
    <Button variant="raised" size="sm" onClick={copy} onMouseLeave={() => setCopied(false)} className="rounded-[9px] text-text-strong-950">
      {glyph}
      {copied ? "Copied" : label}
    </Button>
  ) : (
    <Button variant="raised" size="icon-sm" aria-label={label} onClick={copy} onMouseLeave={() => setCopied(false)} className="rounded-[9px]">
      {glyph}
    </Button>
  );
}

function ConfigurationSection() {
  const { port, startWithQuotio } = usePreferences().proxy;
  const setPort = useSetProxyPort();
  const [draft, setDraft] = useState(String(port));
  const value = Number(draft);
  const valid = isPort(value) && value >= 1024;
  return (
    <SettingsSection title="Configuration" description="Changing the port restarts the proxy.">
      <SettingsRow
        label="Port"
        help={setPort.error ? <span className="text-state-error">{setPort.error.message}</span> : !valid ? "Use a port from 1024 to 65535." : undefined}
      >
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && value !== port) setPort.mutate(value);
          }}
        >
          <Input
            aria-label="Port"
            inputMode="numeric"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-invalid={!valid}
            className="h-9 w-24 font-mono"
          />
          <Button type="submit" variant="raised" disabled={!valid || value === port || setPort.isPending} className="h-9 rounded-[10px]">
            Save
          </Button>
        </form>
      </SettingsRow>
      <SettingsRow label="Start with Quotio" help="Launch the proxy automatically when Quotio opens.">
        <Switch
          aria-label="Start with Quotio"
          checked={startWithQuotio}
          onCheckedChange={(next) => updatePreferences((preferences) => ({ ...preferences, proxy: { ...preferences.proxy, startWithQuotio: next } }))}
        />
      </SettingsRow>
    </SettingsSection>
  );
}

function VersionSection({ status }: { status: ProxyStatus }) {
  const releases = useProxyReleases();
  const command = useProxyCommand();
  const [managing, setManaging] = useState(false);
  const update = availableUpdate(status, releases.data);
  const installing = status.job !== null;
  return (
    <SettingsSection
      title="Version"
      description="Quotio tries each new version on a spare port before switching to it, and keeps the two most recent versions so you can roll back."
      className="gap-3"
    >
      {status.job && <JobRow job={projectJob(status.job)} />}
      {update ? (
        <div className="flex items-center gap-3 rounded-2xl bg-alpha-primary-10 px-4 py-3">
          <RiDownloadCloud2Line className="size-5 shrink-0 text-primary-base" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm leading-5 font-medium text-text-strong-950">v{update.version} is available</span>
            <span className={cn("text-xs leading-4", command.error ? "text-state-error" : "text-text-sub-600")}>
              {command.error ? command.error.message : `You’re on v${status.active}.`}
            </span>
          </div>
          <Button
            variant="inverse"
            size="sm"
            disabled={command.isPending || installing}
            onClick={() => command.mutate({ kind: "install", version: update.version, start: false })}
            className="rounded-[9px]"
          >
            {command.isPending || installing ? "Updating…" : "Update"}
          </Button>
        </div>
      ) : (
        <SettingsRow
          className="py-0"
          label={`v${status.active}`}
          help={
            releases.error
              ? <span className="text-state-error">Couldn’t check for updates. {releases.error.message}</span>
              : releases.isFetching
                ? "Checking for updates…"
                : "Up to date."
          }
        >
          <Button variant="raised" size="sm" disabled={releases.isFetching} onClick={() => void releases.refetch()} className="rounded-[9px]">
            Check now
          </Button>
        </SettingsRow>
      )}
      <button
        type="button"
        onClick={() => setManaging(true)}
        className="flex w-fit cursor-pointer items-center gap-1.5 text-sm leading-5 font-medium text-text-sub-600 hover:text-text-strong-950"
      >
        <RiStackLine className="size-[15px]" />
        Manage versions…
      </button>
      <VersionsDialog open={managing} onOpenChange={setManaging} status={status} />
    </SettingsSection>
  );
}

function VersionsDialog({ open, onOpenChange, status }: { open: boolean; onOpenChange: (open: boolean) => void; status: ProxyStatus }) {
  const releases = useProxyReleases();
  const command = useProxyCommand();
  const rows = projectVersions(status, releases.data ?? []);
  const busy = command.isPending || status.job !== null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>CLIProxyAPI versions</DialogTitle>
          <DialogDescription>
            Switching restarts a running proxy. Installing a version tries it first, then keeps it and the one you’re on; older downloads are
            removed.
          </DialogDescription>
        </DialogHeader>
        {status.job && <JobRow job={projectJob(status.job)} />}
        <div className="flex max-h-[320px] flex-col overflow-y-auto rounded-2xl border border-stroke-soft-200">
          {rows.map((row) => (
            <div key={row.version} className="flex items-center gap-3 border-t border-stroke-soft-200 px-4 py-2.5 first:border-t-0">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-mono text-sm leading-5 text-text-strong-950">v{row.version}</span>
                <span className="text-xs leading-4 text-text-sub-600">
                  {[row.action === "install" ? null : "Installed", formatDate(row.publishedAt)].filter(Boolean).join(" · ") || "Installed"}
                </span>
              </div>
              {row.action === "current" ? (
                <span className="rounded-md bg-alpha-primary-10 px-2 py-0.5 text-xs font-medium text-primary-base">In use</span>
              ) : (
                <Button
                  variant="raised"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    command.mutate(row.action === "use" ? { kind: "use", version: row.version } : { kind: "install", version: row.version, start: false })
                  }
                  className="rounded-[9px]"
                >
                  {row.action === "install" ? "Install" : status.active && compareVersions(row.version, status.active) < 0 ? "Roll back" : "Use"}
                </Button>
              )}
            </div>
          ))}
          {releases.isLoading && <Skeleton className="m-3 h-8" />}
        </div>
        {(command.error ?? releases.error) && (
          <p className="text-sm text-state-error">{(command.error ?? releases.error)?.message}</p>
        )}
        <DialogFooter>
          <Button variant="raised" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
