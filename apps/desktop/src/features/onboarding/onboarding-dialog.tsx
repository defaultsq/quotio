import { Fragment, useState, type ReactNode } from "react";
import {
  RiCheckLine,
  RiNotification3Line,
  RiPieChart2Line,
  RiShieldCheckLine,
  RiLayoutBottomLine,
  type RemixiconComponentType,
} from "@remixicon/react";
import { platform } from "@tauri-apps/plugin-os";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FoundLogins } from "@/features/accounts/found-logins";
import { useAccountsView, useFoundLogins } from "@/features/accounts/queries";
import { updatePreferences, usePreferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";

const steps = [
  { id: "welcome", label: "Welcome" },
  { id: "connect", label: "Connect" },
  { id: "done", label: "Done" },
] as const;

type Step = (typeof steps)[number]["id"];

/** The first-run guide; shown while `onboarded` is false, so General can reopen it by clearing the flag. */
export function OnboardingDialog() {
  const { onboarded } = usePreferences();
  const [step, setStep] = useState<Step>("welcome");
  const finish = () => {
    updatePreferences((preferences) => ({ ...preferences, onboarded: true }));
    setStep("welcome");
  };
  return (
    <Dialog open={!onboarded} onOpenChange={(open) => !open && finish()}>
      <DialogContent className="gap-0 overflow-hidden rounded-[20px] border-0 bg-bg-white-0 p-0 sm:max-w-[640px]">
        <Stepper current={step} />
        {step === "welcome" && <Welcome onNext={() => setStep("connect")} onSkip={finish} />}
        {step === "connect" && <Connect onBack={() => setStep("welcome")} onNext={() => setStep("done")} />}
        {step === "done" && <Done onBack={() => setStep("connect")} onFinish={finish} />}
      </DialogContent>
    </Dialog>
  );
}

function Stepper({ current }: { current: Step }) {
  const index = steps.findIndex((step) => step.id === current);
  return (
    <ol className="flex items-center gap-2 px-7 pt-6 pb-2">
      {steps.map((step, position) => (
        <Fragment key={step.id}>
          {position > 0 && <li aria-hidden className={cn("h-px w-8", position <= index ? "bg-primary-base" : "bg-stroke-soft-200")} />}
          <li className="flex items-center gap-2" aria-current={position === index ? "step" : undefined}>
            <span
              className={cn(
                "grid size-5 place-items-center rounded-full text-[11px] font-semibold",
                position < index && "bg-primary-base text-bg-white-0",
                position === index && "bg-text-strong-950 text-bg-white-0",
                position > index && "border border-stroke-soft-200 text-text-soft-400",
              )}
            >
              {position < index ? <RiCheckLine className="size-3" /> : position + 1}
            </span>
            <span
              className={cn(
                "text-xs leading-4",
                position === index ? "font-semibold text-text-strong-950" : position < index ? "font-medium text-text-sub-600" : "font-medium text-text-soft-400",
              )}
            >
              {step.label}
            </span>
          </li>
        </Fragment>
      ))}
    </ol>
  );
}

function Body({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-5 px-7 pt-4 pb-6">
      <div className="flex flex-col gap-1.5">
        <DialogTitle className="text-xl leading-7 font-semibold tracking-[-0.3px] text-text-strong-950">{title}</DialogTitle>
        <DialogDescription className="text-sm text-text-sub-600">{subtitle}</DialogDescription>
      </div>
      {children}
    </div>
  );
}

function Footer({ back, hint, children }: { back?: { label: string; onClick: () => void }; hint?: string; children: ReactNode }) {
  return (
    <footer className="flex items-center gap-3 border-t border-stroke-soft-200 bg-bg-weak-50 px-7 py-4">
      {back && (
        <button type="button" onClick={back.onClick} className="cursor-pointer text-sm leading-5 font-medium text-text-sub-600 hover:text-text-strong-950">
          {back.label}
        </button>
      )}
      <span className="flex-1" />
      {hint && <span className="text-xs leading-4 text-text-soft-400">{hint}</span>}
      {children}
    </footer>
  );
}

const highlights: { icon: RemixiconComponentType; title: string; detail: string }[] = [
  { icon: RiPieChart2Line, title: "Every limit in one place", detail: "Session, weekly and daily quota for Claude, Codex, Gemini and more." },
  { icon: RiNotification3Line, title: "Alerts before you run out", detail: "A notification when a limit runs low or a sign-in expires." },
  { icon: RiShieldCheckLine, title: "Stays on this computer", detail: "Quotio reads the logins your tools already use. Nothing is uploaded." },
];

function Welcome({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  return (
    <>
      <Body title="Welcome to Quotio" subtitle="See how much AI quota you have left, across every tool you use.">
        <ul className="flex flex-col rounded-2xl border border-stroke-soft-200">
          {highlights.map(({ icon: Icon, title, detail }) => (
            <li key={title} className="flex items-center gap-3 border-b border-stroke-soft-200 px-4 py-3 last:border-b-0">
              <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-alpha-primary-10 text-primary-base">
                <Icon className="size-4" />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-sm leading-5 font-medium text-text-strong-950">{title}</span>
                <span className="text-xs leading-4 text-text-sub-600">{detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </Body>
      <Footer back={{ label: "Skip", onClick: onSkip }}>
        <Button variant="inverse" onClick={onNext}>
          Get started
        </Button>
      </Footer>
    </>
  );
}

function Connect({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { view } = useAccountsView();
  const { found: connect } = useFoundLogins();
  const ready = view?.accountCount ?? 0;

  return (
    <>
      <Body
        title={
          !connect
            ? "Looking for logins on this computer…"
            : connect.found.length === 0
              ? "No logins found yet"
              : `We found ${connect.found.length} ${connect.found.length === 1 ? "provider" : "providers"} on this computer`
        }
        subtitle="Quotio reads logins your CLIs already use. Nothing is uploaded."
      >
        <FoundLogins />
        {connect && connect.others.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <span className="text-xs leading-4 font-medium text-text-soft-400">Also supported, once you sign in to their tool</span>
            <ul className="flex flex-wrap gap-2">
              {connect.others.slice(0, 6).map((provider) => (
                <li key={provider.id} className="flex h-8 items-center gap-1.5 rounded-full border border-stroke-soft-200 px-3 text-sm leading-5 font-medium text-text-strong-950">
                  <ProviderLogo provider={provider} className="size-3.5" />
                  {provider.name}
                </li>
              ))}
              {connect.others.length > 6 && (
                <li className="flex h-8 items-center rounded-full bg-bg-weak-50 px-3 text-sm leading-5 font-medium text-text-sub-600">
                  +{connect.others.length - 6} more
                </li>
              )}
            </ul>
          </div>
        )}
      </Body>
      <Footer back={{ label: "Back", onClick: onBack }} hint="You can add providers later">
        <Button variant="inverse" onClick={onNext}>
          {ready > 0 ? "Continue" : "Skip for now"}
        </Button>
      </Footer>
    </>
  );
}

function Done({ onBack, onFinish }: { onBack: () => void; onFinish: () => void }) {
  const { view } = useAccountsView();
  const os = platform();
  const count = view?.accountCount ?? 0;
  return (
    <>
      <Body
        title="You’re all set"
        subtitle={count > 0 ? `Quotio is tracking ${count} ${count === 1 ? "account" : "accounts"}.` : "Add accounts any time from the Accounts page."}
      >
        <div className="flex items-center gap-3 rounded-2xl border border-stroke-soft-200 px-4 py-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-alpha-primary-10 text-primary-base">
            <RiLayoutBottomLine className="size-4" />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-sm leading-5 font-medium text-text-strong-950">Quotio keeps running in the tray</span>
            <span className="text-xs leading-4 text-text-sub-600">
              {os === "linux"
                ? "Open the Quotio tray menu and choose Show quota. Closing this window keeps Quotio running."
                : "Click the Quotio icon in the tray to see quota. Closing this window keeps Quotio running."}
            </span>
          </span>
        </div>
      </Body>
      <Footer back={{ label: "Back", onClick: onBack }}>
        <Button variant="inverse" onClick={onFinish}>
          Start using Quotio
        </Button>
      </Footer>
    </>
  );
}
