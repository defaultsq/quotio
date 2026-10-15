import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RiErrorWarningLine,
  RiHourglassLine,
  RiKey2Line,
  RiNotification3Line,
  RiPieChart2Line,
} from "@remixicon/react";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { IconTile, SettingsHeader, SettingsRow, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { quotaThresholds, updatePreferences, usePreferences, type Preferences, type QuotaThreshold } from "@/lib/preferences";
import { cn } from "@/lib/utils";

type Alerts = Preferences["notifications"];

function setAlerts(change: Partial<Alerts>) {
  updatePreferences((preferences) => ({ ...preferences, notifications: { ...preferences.notifications, ...change } }));
}

const permissionKey = ["notification-permission"];

function useNotificationPermission() {
  const client = useQueryClient();
  const granted = useQuery({ queryKey: permissionKey, queryFn: isPermissionGranted });
  const request = useMutation({
    mutationFn: async () => (await requestPermission()) === "granted",
    onSuccess: (allowed) => client.setQueryData(permissionKey, allowed),
  });
  return { granted: granted.data, request };
}

export function NotificationsPage() {
  const { notifications: alerts } = usePreferences();
  const permission = useNotificationPermission();
  return (
    <>
      <SettingsHeader title="Notifications" subtitle="Hear about low quota before you run out, not after.">
        <label className="flex items-center gap-2.5 text-sm leading-5 font-medium text-text-strong-950">
          {alerts.enabled ? "Notifications on" : "Notifications off"}
          <Switch checked={alerts.enabled} onCheckedChange={(enabled) => setAlerts({ enabled })} />
        </label>
      </SettingsHeader>

      {alerts.enabled && permission.granted === false && (
        <div className="flex items-center gap-3 rounded-2xl bg-alpha-away-10 px-4 py-3">
          <RiErrorWarningLine className="size-[18px] shrink-0 text-state-away" />
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-sm leading-5 font-medium text-text-strong-950">Your system is blocking Quotio’s notifications</span>
            <span className="text-xs leading-4 text-text-sub-600">
              {permission.request.data === false
                ? "Allow them for Quotio in your system’s notification settings."
                : "Quotio needs permission before it can alert you."}
            </span>
          </div>
          <Button
            variant="raised"
            size="sm"
            disabled={permission.request.isPending}
            onClick={() => permission.request.mutate()}
          >
            Allow notifications
          </Button>
        </div>
      )}

      <SettingsSection title="Alerts" description="Choose what Quotio tells you about." className={cn(!alerts.enabled && "opacity-50")}>
        <SettingsRow
          icon={<IconTile icon={RiPieChart2Line} tone="error" />}
          label="Quota running low"
          help="When any limit drops below the threshold."
        >
          <Select
            value={String(alerts.quotaLowThreshold)}
            disabled={!alerts.enabled || !alerts.quotaLow}
            onValueChange={(value) => setAlerts({ quotaLowThreshold: Number(value) as QuotaThreshold })}
          >
            <SelectTrigger size="sm" aria-label="Low quota threshold" className="gap-1.5 px-2.5">
              <span className="text-text-soft-400">Below</span>
              <span className="font-medium">{alerts.quotaLowThreshold}%</span>
            </SelectTrigger>
            <SelectContent>
              {quotaThresholds.map((threshold) => (
                <SelectItem key={threshold} value={String(threshold)}>
                  {threshold}%
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Switch
            aria-label="Quota running low"
            checked={alerts.quotaLow}
            disabled={!alerts.enabled}
            onCheckedChange={(quotaLow) => setAlerts({ quotaLow })}
          />
        </SettingsRow>
        <SettingsRow
          icon={<IconTile icon={RiHourglassLine} tone="warning" />}
          label="Account cooling down"
          help="When an account hits its limit and waits for a reset."
        >
          <Switch
            aria-label="Account cooling down"
            checked={alerts.coolingDown}
            disabled={!alerts.enabled}
            onCheckedChange={(coolingDown) => setAlerts({ coolingDown })}
          />
        </SettingsRow>
        <SettingsRow
          icon={<IconTile icon={RiKey2Line} />}
          label="Sign-in expired"
          help="When an account needs you to sign in again."
        >
          <Switch
            aria-label="Sign-in expired"
            checked={alerts.signInExpired}
            disabled={!alerts.enabled}
            onCheckedChange={(signInExpired) => setAlerts({ signInExpired })}
          />
        </SettingsRow>
      </SettingsSection>

      <TestSection disabled={!alerts.enabled} />
    </>
  );
}

function TestSection({ disabled }: { disabled: boolean }) {
  const send = useMutation({
    mutationFn: async () => {
      const allowed = (await isPermissionGranted()) || (await requestPermission()) === "granted";
      if (!allowed) throw new Error("Your system is blocking Quotio’s notifications.");
      sendNotification({ title: "Codex weekly quota at 18%", body: "This is a test from Quotio. Real alerts name the account and when it resets." });
    },
  });
  return (
    <SettingsSection title="What you’ll see" description="Notifications name the account and when it resets." className="gap-3">
      <div className="flex justify-end rounded-2xl bg-bg-weak-50 p-5">
        <div className="flex w-[340px] gap-3 rounded-xl bg-bg-white-0 p-3 shadow-card">
          <div className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-text-strong-950 text-bg-white-0">
            <RiNotification3Line className="size-[18px]" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex justify-between gap-2">
              <span className="text-[13px] font-semibold text-text-strong-950">Codex weekly quota at 18%</span>
              <span className="text-[11px] text-text-soft-400">now</span>
            </div>
            <span className="text-[13px] leading-[1.4] text-text-sub-600">you@example.com · resets Thu 14:20</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="raised" size="sm" disabled={disabled || send.isPending} onClick={() => send.mutate()}>
          Send test notification
        </Button>
        <span className={cn("text-xs", send.error ? "text-state-error" : "text-text-soft-400")}>
          {send.error ? send.error.message : send.isSuccess ? "Sent. Check your notification area." : null}
        </span>
      </div>
    </SettingsSection>
  );
}
