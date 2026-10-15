import { useState } from "react";
import { RiCheckLine, RiFileCopyLine } from "@remixicon/react";
import { hostname } from "@tauri-apps/plugin-os";
import { QrCode } from "@/components/qr-code";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Sharing } from "@/lib/api/client";
import { modeCopy, pairableEndpoints, pairingPayload } from "./model";
import { useCreateDevice } from "./queries";

type Issued = { label: string; payload: string; expiresAt: string };

export function PairDialog({ open, onOpenChange, sharing }: { open: boolean; onOpenChange: (open: boolean) => void; sharing: Sharing }) {
  const [issued, setIssued] = useState<Issued | null>(null);
  const close = (next: boolean) => {
    onOpenChange(next);
    // The payload is a credential; drop it from memory as soon as the dialog closes.
    if (!next) setIssued(null);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        {issued ? <IssuedStep issued={issued} onDone={() => close(false)} /> : <FormStep sharing={sharing} onIssued={setIssued} />}
      </DialogContent>
    </Dialog>
  );
}

function FormStep({ sharing, onIssued }: { sharing: Sharing; onIssued: (issued: Issued) => void }) {
  const endpoints = pairableEndpoints(sharing);
  const [label, setLabel] = useState("iPhone");
  const [origin, setOrigin] = useState(endpoints[0]?.public_url ?? "");
  const create = useCreateDevice();
  const endpoint = endpoints.find((endpoint) => endpoint.public_url === origin);
  const name = label.trim();

  const submit = async () => {
    if (!endpoint || !name) return;
    const created = await create.mutateAsync(name);
    const host = (await hostname().catch(() => null)) ?? new URL(endpoint.public_url).hostname;
    onIssued({ label: name, payload: pairingPayload(created, endpoint, host), expiresAt: created.client.expires_at });
  };

  return (
    <form
      className="flex min-w-0 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit().catch(() => undefined);
      }}
    >
      <DialogHeader>
        <DialogTitle>Pair iPhone</DialogTitle>
        <DialogDescription>The iPhone gets read-only access to quota for 30 days. Sign-ins stay on this computer.</DialogDescription>
      </DialogHeader>
      {endpoints.length === 0 ? (
        <p className="rounded-xl bg-bg-weak-50 px-3 py-2.5 text-sm text-text-sub-600">
          Turn on Local network or Tailscale first, so your iPhone has a way to reach this computer.
        </p>
      ) : (
        <>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-text-strong-950">
            Device name
            <Input value={label} maxLength={64} onChange={(event) => setLabel(event.target.value)} />
          </label>
          {endpoints.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-text-strong-950">Connect over</span>
              <ToggleGroup
                type="single"
                variant="outline"
                value={origin}
                onValueChange={(value) => value && setOrigin(value)}
                className="w-full"
              >
                {endpoints.map((endpoint) => (
                  <ToggleGroupItem key={endpoint.public_url} value={endpoint.public_url} className="flex-1">
                    {modeCopy[endpoint.mode].title}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}
        </>
      )}
      {create.error && <p className="text-sm text-state-error">Couldn’t create a pairing code. {create.error.message}</p>}
      <DialogFooter>
        <Button type="submit" variant="inverse" size="sm" disabled={!endpoint || !name || create.isPending}>
          {create.isPending ? "Creating…" : "Create pairing code"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function IssuedStep({ issued, onDone }: { issued: Issued; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const expires = new Date(issued.expiresAt).toLocaleDateString(undefined, { month: "long", day: "numeric" });
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Scan with Quotio on your iPhone</DialogTitle>
        <DialogDescription>
          This code works like a password for {issued.label} until {expires} or until you revoke it. It’s shown only once.
        </DialogDescription>
      </DialogHeader>
      <QrCode value={issued.payload} label={`Pairing code for ${issued.label}`} className="mx-auto size-64 shadow-raised" />
      <div className="flex items-center gap-2 rounded-xl bg-bg-weak-50 px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-text-sub-600">{issued.payload}</code>
        <Button
          variant="raised"
          size="xs"
          onClick={() => navigator.clipboard.writeText(issued.payload).then(() => setCopied(true))}
        >
          {copied ? <RiCheckLine /> : <RiFileCopyLine />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <DialogFooter>
        <Button variant="inverse" size="sm" onClick={onDone} className="min-w-20">
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}
