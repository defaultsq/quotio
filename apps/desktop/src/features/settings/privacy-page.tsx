import { RiLock2Line, RiLockUnlockLine } from "@remixicon/react";
import { platform } from "@tauri-apps/plugin-os";
import { SensitiveText } from "@/components/sensitive-text";
import { IconTile, SettingsHeader, SettingsRow, SettingsSection } from "@/components/settings";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { updatePreferences, usePreferences } from "@/lib/preferences";
import { storageView, type StoragePlatform } from "./model";
import { useHostStatus } from "./queries";

export function PrivacyPage() {
  const { hideAccountNames } = usePreferences();
  return (
    <>
      <SettingsHeader
        title="Privacy"
        subtitle="Credentials never leave this computer. Here’s where Quotio keeps them, and how to hide them on screen."
      />
      <SettingsSection title="On screen" description="Useful when screen sharing or recording." className="gap-3">
        <SettingsRow
          label="Hide account names"
          help="Names and emails are blurred everywhere. Click one to reveal it for a moment."
        >
          <Switch
            aria-label="Hide account names"
            checked={hideAccountNames}
            onCheckedChange={(on) => updatePreferences((preferences) => ({ ...preferences, hideAccountNames: on }))}
          />
        </SettingsRow>
        <div className="flex items-center gap-3 rounded-xl bg-bg-weak-50 px-3 py-2.5">
          <span aria-hidden className="size-2 rounded-full bg-[#d97757]" />
          <SensitiveText className="text-sm leading-5 font-medium text-text-strong-950">you@example.com</SensitiveText>
          <span className="flex-1" />
          <span className="text-sm leading-5 font-semibold text-text-strong-950">74%</span>
        </div>
      </SettingsSection>
      <StorageSection />
    </>
  );
}

function StorageSection() {
  const status = useHostStatus();
  return (
    <SettingsSection title="Saved accounts" description="Accounts you add in Quotio are kept by its background service.">
      {status.data ? (
        <StorageCard {...storageView(status.data, currentPlatform())} />
      ) : status.error ? (
        <p className="text-sm text-state-error">Couldn’t read storage status. {status.error.message}</p>
      ) : (
        <Skeleton className="h-14 w-full rounded-2xl" />
      )}
    </SettingsSection>
  );
}

function StorageCard({ title, detail, enabled }: { title: string; detail: string; enabled: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-bg-weak-50 px-4 py-3">
      <IconTile icon={enabled ? RiLock2Line : RiLockUnlockLine} tone="raised" />
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm leading-5 font-medium text-text-strong-950">{title}</span>
        <span className="text-xs leading-4 text-text-sub-600">{detail}</span>
      </div>
    </div>
  );
}

function currentPlatform(): StoragePlatform {
  const name = platform();
  return name === "windows" || name === "linux" || name === "macos" ? name : "other";
}
