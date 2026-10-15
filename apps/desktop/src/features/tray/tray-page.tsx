import { useState } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import { SettingsHeader, SettingsRow, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAccountsView } from "@/features/accounts/queries";
import { useClearHistory } from "@/features/history/queries";
import { useSettings, useUpdateSettings } from "@/features/settings/queries";
import { trayDensities, updatePreferences, usePreferences, type Preferences, type TrayDensity } from "@/lib/preferences";
import { cn } from "@/lib/utils";

type Tray = Preferences["tray"];

function setTray(change: Partial<Tray>) {
  updatePreferences((preferences) => ({ ...preferences, tray: { ...preferences.tray, ...change } }));
}

export function TrayPage() {
  return (
    <>
      <SettingsHeader title="Tray" subtitle="What the tray icon shows, and how quota looks in its popover." />
      <TraySection />
      <DensitySection />
      <HistorySection />
    </>
  );
}

function TraySection() {
  const { tray } = usePreferences();
  const { view } = useAccountsView();
  const hidden = new Set(tray.hiddenProviders);
  return (
    <SettingsSection title="Tray icon" description="Closing the Quotio window keeps it running here. Quit from the tray to stop it.">
      <SettingsRow label="Lowest quota in the tooltip" help="Hovering the icon names the limit closest to running out.">
        <Switch
          aria-label="Lowest quota in the tooltip"
          checked={tray.percentInTooltip}
          onCheckedChange={(percentInTooltip) => setTray({ percentInTooltip })}
        />
      </SettingsRow>
      <SettingsRow label="Providers in the popover" help="Hidden providers keep refreshing and still send alerts." className="items-start">
        {!view ? (
          <Skeleton className="h-8 w-40" />
        ) : view.groups.length === 0 ? (
          <span className="text-xs text-text-soft-400">No connected providers yet</span>
        ) : null}
      </SettingsRow>
      {view && view.groups.length > 0 && (
        <ul className="flex flex-col gap-1 pb-1">
          {view.groups.map(({ provider, accounts }) => (
            <li key={provider.id} className="flex items-center gap-3 rounded-[10px] px-2 py-1.5 hover:bg-bg-weak-50">
              <ProviderLogo provider={provider} className="size-4" />
              <span className="flex-1 text-sm leading-5 text-text-strong-950">{provider.name}</span>
              <span className="text-xs text-text-soft-400">{accounts.length === 1 ? "1 account" : `${accounts.length} accounts`}</span>
              <Switch
                aria-label={`Show ${provider.name} in the popover`}
                checked={!hidden.has(provider.id)}
                onCheckedChange={(shown) =>
                  setTray({
                    hiddenProviders: shown
                      ? tray.hiddenProviders.filter((id) => id !== provider.id)
                      : [...tray.hiddenProviders, provider.id],
                  })
                }
              />
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}

const densityOptions: Record<TrayDensity, { label: string; help: string }> = {
  compact: { label: "Compact", help: "One line per account" },
  comfortable: { label: "Comfortable", help: "Every limit, with pace" },
};

function DensitySection() {
  const { tray } = usePreferences();
  return (
    <SettingsSection title="Quota display" description="How each account looks in the tray popover." className="gap-3">
      <ToggleGroup
        type="single"
        aria-label="Popover density"
        value={tray.density}
        onValueChange={(value) => value && setTray({ density: value as TrayDensity })}
        className="grid w-full grid-cols-2 gap-3"
      >
        {trayDensities.map((id) => (
          <ToggleGroupItem
            key={id}
            value={id}
            className={cn(
              "flex h-auto cursor-pointer flex-col items-stretch gap-2 rounded-[14px] border-2 p-1.5 hover:bg-transparent data-[state=on]:bg-transparent",
              id === tray.density ? "border-primary-base" : "border-stroke-soft-200",
            )}
          >
            <span className="flex h-[84px] flex-col justify-center gap-2 rounded-[10px] bg-bg-weak-50 px-2.5 py-2">
              {id === "compact" ? <CompactPreview /> : <ComfortablePreview />}
            </span>
            <span className="flex flex-col px-1 pb-0.5 text-left">
              <span className="text-sm leading-5 font-medium text-text-strong-950">{densityOptions[id].label}</span>
              <span className="text-[11px] text-text-soft-400">{densityOptions[id].help}</span>
            </span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="text-xs text-text-sub-600">
        The tick shows where you’d be if you spread usage evenly until the reset. Fill left of the tick means you’re
        using it faster than it refills.
      </p>
    </SettingsSection>
  );
}

function CompactPreview() {
  return (
    <>
      {[
        [70, "bg-primary-base"],
        [20, "bg-state-away"],
        [90, "bg-primary-base"],
      ].map(([width, fill], index) => (
        <span key={index} className="flex items-center gap-1.5">
          <span className="h-1.5 flex-1 rounded-full bg-stroke-soft-200" />
          <span className="relative h-1 w-8 rounded-full bg-stroke-soft-200">
            <span className={cn("absolute inset-y-0 left-0 rounded-full", fill)} style={{ width: `${width}%` }} />
          </span>
        </span>
      ))}
    </>
  );
}

function ComfortablePreview() {
  return (
    <>
      <span className="h-1.5 w-14 rounded-full bg-stroke-soft-200" />
      {[
        [74, 34, "bg-primary-base"],
        [18, 68, "bg-state-away"],
      ].map(([width, tick, fill], index) => (
        <span key={index} className="relative h-1.5 w-full rounded-full bg-stroke-soft-200">
          <span className={cn("absolute inset-y-0 left-0 rounded-full", fill)} style={{ width: `${width}%` }} />
          <span className="absolute -top-0.5 h-2.5 w-0.5 bg-text-strong-950" style={{ left: `${tick}%` }} />
        </span>
      ))}
    </>
  );
}

function HistorySection() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const { view } = useAccountsView();
  const clear = useClearHistory();
  const [confirming, setConfirming] = useState(false);
  const writable = view?.history.writable ?? false;
  const locked = settings.data?.overridden.includes("quota_history_enabled") ?? false;
  const recording = settings.data?.quota_history_enabled ?? false;

  return (
    <SettingsSection
      title="Quota history"
      description="Recorded on this computer while Quotio runs. Recording doesn’t change how often quota refreshes."
    >
      <SettingsRow
        label="Record quota history"
        help={
          !view || !settings.data ? (
            " "
          ) : !writable ? (
            "History isn’t available while saved accounts are off."
          ) : locked ? (
            "Set by a startup option."
          ) : (
            <span className="flex items-center gap-1.5">
              <span className={cn("size-1.5 rounded-full", recording ? "bg-state-stable" : "bg-text-soft-400")} />
              {recording ? "Recording · kept for 30 days" : "Paused"}
            </span>
          )
        }
      >
        <Switch
          aria-label="Record quota history"
          checked={recording}
          disabled={!settings.data || !writable || locked}
          onCheckedChange={(on) => update.mutate({ quota_history_enabled: on })}
        />
      </SettingsRow>
      <SettingsRow
        label="Clear all history"
        help={clear.error ? `Couldn’t clear history. ${clear.error.message}` : clear.isSuccess ? "History cleared." : "Accounts, sign-ins and current quota are kept."}
      >
        <Button variant="raised" size="sm" disabled={!writable || clear.isPending} onClick={() => setConfirming(true)}>
          Clear…
        </Button>
      </SettingsRow>
      {update.error && (
        <p role="alert" className="pt-1 text-xs text-state-error">
          Couldn’t save the change. {update.error.message}
        </p>
      )}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear all quota history?</DialogTitle>
            <DialogDescription>
              Every account’s recorded history is deleted from this computer. This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="raised" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setConfirming(false);
                clear.mutate();
              }}
            >
              Clear history
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
