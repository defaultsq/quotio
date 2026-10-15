import { useState } from "react";
import {
  RiArrowRightSLine,
  RiCheckLine,
  RiFileCopyLine,
  RiInformationLine,
  RiQrCodeLine,
  RiShieldKeyholeLine,
  RiSmartphoneLine,
  RiWifiLine,
} from "@remixicon/react";
import { IconTile, SettingsHeader, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { Client } from "@/lib/api/client";
import { isPort, usePreferences, type DirectSharingMode } from "@/lib/preferences";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { modeCopy, projectConnections, projectDevices, sharingErrorMessage, type ConnectionView } from "./model";
import { PairDialog } from "./pair-dialog";
import { useDevices, useRevokeDevice, useSetConnection, useSetSharingPort, useSharing } from "./queries";

const modeIcon: Record<DirectSharingMode, typeof RiWifiLine> = {
  local_network: RiWifiLine,
  tailscale: RiShieldKeyholeLine,
};

/** `pairOnOpen` opens the pairing dialog as soon as sharing status loads (the tray's "Pair iPhone…"). */
export function SharingPage({ pairOnOpen = false }: { pairOnOpen?: boolean }) {
  const sharing = useSharing();
  const [pairing, setPairing] = useState(pairOnOpen);
  return (
    <>
      <SettingsHeader
        title="iPhone Sharing"
        subtitle="See quota on your iPhone and in widgets. Read-only: sign-ins stay on this computer."
      >
        <Button variant="inverse" disabled={!sharing.data} onClick={() => setPairing(true)} className="h-9 rounded-[10px] px-3.5">
          <RiQrCodeLine />
          Pair iPhone
        </Button>
      </SettingsHeader>

      <SettingsSection
        title="Connection"
        description="Turn on one or both. You pick which one each iPhone uses when pairing."
        className="gap-3"
      >
        {sharing.data ? (
          <>
            {projectConnections(sharing.data).map((connection) => (
              <ConnectionCard key={connection.mode} connection={connection} />
            ))}
            <AdvancedPort />
          </>
        ) : sharing.error ? (
          <p className="text-sm text-state-error">Couldn’t read sharing status. {sharing.error.message}</p>
        ) : (
          <>
            <Skeleton className="h-[58px] w-full rounded-2xl" />
            <Skeleton className="h-[58px] w-full rounded-2xl" />
          </>
        )}
      </SettingsSection>

      <DevicesSection />
      {sharing.data && <PairDialog open={pairing} onOpenChange={setPairing} sharing={sharing.data} />}
    </>
  );
}

function ConnectionCard({ connection }: { connection: ConnectionView }) {
  const setConnection = useSetConnection();
  const { port } = usePreferences().sharing;
  const { title, help } = modeCopy[connection.mode];
  const on = connection.state === "on";
  const unavailable = connection.state === "off" && connection.candidates.length === 0;
  const pending = setConnection.isPending;
  return (
    <div className="flex flex-col rounded-2xl border border-stroke-soft-200">
      <div className="flex items-center gap-3 px-4 py-3">
        <IconTile icon={modeIcon[connection.mode]} tone={on ? "primary" : "neutral"} />
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-sm leading-5 font-medium text-text-strong-950">{title}</span>
          <span className={cn("text-xs leading-4", setConnection.error ? "text-state-error" : "text-text-sub-600")}>
            {setConnection.error
              ? sharingErrorMessage(setConnection.error, port)
              : unavailable
                ? connection.mode === "tailscale"
                  ? "Tailscale isn’t connected on this computer."
                  : "This computer isn’t on a local network."
                : help}
          </span>
        </div>
        <Switch
          aria-label={title}
          checked={on}
          disabled={pending || (unavailable && !on)}
          onCheckedChange={(next) => setConnection.mutate({ mode: connection.mode, on: next })}
        />
      </div>
      {connection.state === "on" && (
        <div className="flex items-center gap-3 rounded-b-2xl border-t border-stroke-soft-200 bg-bg-weak-50 px-4 py-2.5">
          <span className="text-xs leading-4 text-text-soft-400">Address</span>
          <span className="flex-1 truncate font-mono text-sm leading-5 text-text-strong-950">{connection.url}</span>
          {connection.address && <span className="text-xs leading-4 text-text-soft-400">{connection.address.interface}</span>}
          <CopyButton text={connection.url} label="Copy address" />
        </div>
      )}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}
      onMouseLeave={() => setCopied(false)}
      className="text-text-sub-600"
    >
      {copied ? <RiCheckLine className="size-3.5" /> : <RiFileCopyLine className="size-3.5" />}
    </Button>
  );
}

function AdvancedPort() {
  const { port } = usePreferences().sharing;
  const setPort = useSetSharingPort();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(port));
  const value = Number(draft);
  const valid = isPort(value) && value >= 1024;
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-fit cursor-pointer items-center gap-1.5 text-sm leading-5 font-medium text-text-sub-600 hover:text-text-strong-950"
      >
        <RiArrowRightSLine className={cn("size-4 transition-transform", open && "rotate-90")} />
        Advanced · port {port}
      </button>
      {open && (
        <form
          className="flex items-center gap-2 pl-5.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && value !== port) setPort.mutate(value);
          }}
        >
          <label htmlFor="sharing-port" className="text-sm text-text-sub-600">
            Port
          </label>
          <Input
            id="sharing-port"
            inputMode="numeric"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-invalid={!valid}
            className="h-8 w-24"
          />
          <Button type="submit" variant="raised" size="sm" disabled={!valid || value === port || setPort.isPending}>
            Apply
          </Button>
          <span className={cn("text-xs", setPort.error ? "text-state-error" : "text-text-soft-400")}>
            {setPort.error
              ? sharingErrorMessage(setPort.error, value)
              : "Changing the port moves the address; pair your iPhone again afterwards."}
          </span>
        </form>
      )}
    </div>
  );
}

function DevicesSection() {
  const devices = useDevices();
  const [revoking, setRevoking] = useState<Client | null>(null);
  const now = useNow(60_000);
  const views = devices.data ? projectDevices(devices.data, now) : [];
  return (
    <SettingsSection
      title="Paired devices"
      description="Each device can only read quota. Access lasts 30 days, or until you revoke it."
      className="gap-3"
    >
      {devices.error ? (
        <p className="text-sm text-state-error">Couldn’t load paired devices. {devices.error.message}</p>
      ) : !devices.data ? (
        <Skeleton className="h-[58px] w-full rounded-2xl" />
      ) : views.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-stroke-soft-200 px-4 py-5 text-center text-sm text-text-soft-400">
          No devices yet. Use Pair iPhone to add one.
        </p>
      ) : (
        <div className="flex flex-col rounded-2xl border border-stroke-soft-200">
          {views.map(({ client, detail, expiringSoon }) => (
            <div key={client.id} className="flex items-center gap-3 border-t border-stroke-soft-200 px-4 py-3 first:border-t-0">
              <IconTile icon={RiSmartphoneLine} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm leading-5 font-medium text-text-strong-950">{client.label}</span>
                <span className={cn("text-xs leading-4", expiringSoon ? "text-state-away" : "text-text-sub-600")}>{detail}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRevoking(client)}
                className="rounded-[9px] border-stroke-soft-200 bg-transparent text-state-error shadow-none hover:bg-alpha-red-10 hover:text-state-error"
              >
                Revoke
              </Button>
            </div>
          ))}
        </div>
      )}
      <p className="flex items-center gap-1.5 text-xs leading-4 text-text-soft-400">
        <RiInformationLine className="size-3.5" />
        Keep Quotio running and this computer awake so your iPhone can refresh.
      </p>
      <RevokeDialog client={revoking} onClose={() => setRevoking(null)} />
    </SettingsSection>
  );
}

function RevokeDialog({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const revoke = useRevokeDevice();
  return (
    <Dialog open={client !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Revoke {client?.label}?</DialogTitle>
          <DialogDescription>It stops seeing quota right away. To use it again, pair it with a new code.</DialogDescription>
        </DialogHeader>
        {revoke.error && <p className="text-sm text-state-error">Couldn’t revoke the device. {revoke.error.message}</p>}
        <DialogFooter>
          <Button variant="raised" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={revoke.isPending}
            onClick={() => client && revoke.mutate(client.id, { onSuccess: onClose })}
          >
            {revoke.isPending ? "Revoking…" : "Revoke"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
