import { RiComputerLine, RiMoonLine, RiRefreshLine, RiSunLine, type RemixiconComponentType } from "@remixicon/react";
import { SettingsHeader, SettingsRow, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDiscovery, useScan } from "@/features/accounts/queries";
import { themes, updatePreferences, usePreferences, type Theme } from "@/lib/preferences";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { useLaunchAtLogin } from "./launch-at-login";
import { isOverridden, refreshOptions, scanSummary } from "./model";
import { useSettings, useUpdateSettings } from "./queries";

export function GeneralPage() {
  return (
    <>
      <SettingsHeader title="General" subtitle="Startup, language, appearance and how often quota refreshes." />
      <StartupSection />
      <AppearanceSection />
      <RefreshSection />
      <GuideSection />
    </>
  );
}

function StartupSection() {
  const launch = useLaunchAtLogin();
  return (
    <SettingsSection title="Startup" description="How Quotio starts on this computer.">
      <SettingsRow
        label="Launch at login"
        help={launch.error ? "Your system didn’t accept the change." : "Open Quotio when you sign in."}
      >
        <Switch
          aria-label="Launch at login"
          checked={launch.enabled ?? false}
          disabled={launch.enabled === undefined || launch.pending}
          onCheckedChange={launch.set}
        />
      </SettingsRow>
      <SettingsRow label="Language" help="More languages are coming to the desktop app.">
        <Select value="en" disabled>
          <SelectTrigger aria-label="Language" className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">English</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
    </SettingsSection>
  );
}

const themeOptions: Record<Theme, { label: string; icon: RemixiconComponentType; preview: string }> = {
  system: { label: "System", icon: RiComputerLine, preview: "bg-[linear-gradient(90deg,#f7f7f7_50%,#171717_50%)]" },
  light: { label: "Light", icon: RiSunLine, preview: "bg-[#f7f7f7]" },
  dark: { label: "Dark", icon: RiMoonLine, preview: "bg-[#171717]" },
};

function AppearanceSection() {
  const { theme } = usePreferences();
  return (
    <SettingsSection title="Appearance" description="System follows your computer’s light or dark setting.">
      <ToggleGroup
        type="single"
        aria-label="Theme"
        value={theme}
        onValueChange={(value) => value && updatePreferences((preferences) => ({ ...preferences, theme: value as Theme }))}
        className="grid w-full grid-cols-3 gap-3"
      >
        {themes.map((id) => {
          const { label, icon: Icon, preview } = themeOptions[id];
          return (
            <ToggleGroupItem
              key={id}
              value={id}
              className={cn(
                "flex h-auto cursor-pointer flex-col items-stretch gap-2 rounded-[14px] border-2 p-1.5 hover:bg-transparent data-[state=on]:bg-transparent",
                id === theme ? "border-primary-base text-text-strong-950" : "border-stroke-soft-200 text-text-sub-600",
              )}
            >
              <span className={cn("block h-[72px] rounded-[10px] shadow-raised", preview)} />
              <span className="flex items-center gap-1.5 px-1 pb-0.5 text-sm leading-5 font-medium">
                <Icon className="size-[15px]" />
                {label}
              </span>
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </SettingsSection>
  );
}

function GuideSection() {
  return (
    <SettingsSection title="Getting started" description="The guide that runs the first time Quotio opens.">
      <SettingsRow label="Welcome guide" help="Walk through connecting providers again.">
        <Button variant="raised" size="sm" onClick={() => updatePreferences((preferences) => ({ ...preferences, onboarded: false }))}>
          Show guide
        </Button>
      </SettingsRow>
    </SettingsSection>
  );
}

function RefreshSection() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const discovery = useDiscovery();
  const scan = useScan();
  const now = useNow(30_000);

  if (!settings.data) {
    return (
      <SettingsSection title="Refresh & logins">
        {settings.error ? (
          <p className="py-3 text-sm text-state-error">Couldn’t load refresh settings. {settings.error.message}</p>
        ) : (
          <div aria-busy className="flex flex-col gap-3 py-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        )}
      </SettingsSection>
    );
  }

  const current = settings.data;
  const intervalLocked = isOverridden(current, "refresh_interval");
  const discoverLocked = isOverridden(current, "automatically_discover_logins");
  return (
    <SettingsSection
      title="Refresh & logins"
      description="How often quota updates, and whether Quotio looks for logins already on this computer."
    >
      <SettingsRow
        label="Auto-refresh"
        help={intervalLocked ? "Set by a startup option." : "Choose Manual to refresh only when you ask."}
      >
        <Select
          value={String(current.refresh_interval)}
          disabled={intervalLocked}
          onValueChange={(value) => update.mutate({ refresh_interval: Number(value) })}
        >
          <SelectTrigger aria-label="Auto-refresh" className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {refreshOptions(current.refresh_interval).map((option) => (
              <SelectItem key={option.seconds} value={String(option.seconds)}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow
        label="Detect logins on launch"
        help={discoverLocked ? "Set by a startup option." : "Finds Claude, Codex, Gemini and other logins automatically."}
      >
        <Switch
          aria-label="Detect logins on launch"
          checked={current.automatically_discover_logins}
          disabled={discoverLocked}
          onCheckedChange={(on) => update.mutate({ automatically_discover_logins: on })}
        />
      </SettingsRow>
      <SettingsRow
        label="Scan now"
        help={scan.error ? `The scan failed. ${scan.error.message}` : scanSummary(discovery.data, now)}
      >
        <Button variant="raised" size="sm" disabled={scan.isPending} onClick={() => scan.mutate({})}>
          <RiRefreshLine className={cn("size-[15px]", scan.isPending && "animate-spin")} />
          {scan.isPending ? "Scanning…" : "Scan all providers"}
        </Button>
      </SettingsRow>
      {update.error && (
        <p role="alert" className="pt-1 text-xs text-state-error">
          Couldn’t save the change. {update.error.message}
        </p>
      )}
    </SettingsSection>
  );
}
