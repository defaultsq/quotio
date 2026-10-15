import { useQuery } from "@tanstack/react-query";
import {
  RiArrowRightUpLine,
  RiDownloadCloud2Line,
  RiGithubFill,
  RiHeart3Fill,
  RiServerLine,
  type RemixiconComponentType,
} from "@remixicon/react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { IconTile, SettingsRow, SettingsSection } from "@/components/settings";
import { Switch } from "@/components/ui/switch";
import { updatePreferences, usePreferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { useHostStatus } from "./queries";
import appIcon from "../../../src-tauri/icons/128x128.png";

const REPOSITORY = "https://github.com/nguyenphutrong/quotio";

const links: { title: string; help: string; url: string; icon: RemixiconComponentType; sponsor?: boolean }[] = [
  { title: "Quotio", help: "Source and issues", url: REPOSITORY, icon: RiGithubFill },
  { title: "CLIProxyAPI", help: "The local proxy", url: "https://github.com/router-for-me/CLIProxyAPI", icon: RiServerLine },
  { title: "Support Quotio", help: "Sponsor development", url: "https://www.quotio.dev/sponsors", icon: RiHeart3Fill, sponsor: true },
];

export function AboutPage() {
  const version = useQuery({ queryKey: ["app-version"], queryFn: getVersion, staleTime: Infinity });
  const status = useHostStatus();
  const { autoCheckUpdates } = usePreferences();
  return (
    <>
      <header className="flex items-center gap-5 border-b border-stroke-soft-200 pb-6">
        <img src={appIcon} alt="" className="size-[72px] rounded-[18px] shadow-card" />
        <div className="flex flex-1 flex-col gap-1">
          <h1 className="text-xl leading-7 font-semibold tracking-[-0.3px] text-text-strong-950">Quotio</h1>
          <p className="text-sm leading-5 text-text-sub-600">
            Version {version.data ?? "…"}
            <span className="text-text-soft-400">
              {" · "}Background service {status.data?.server_version ?? (status.error ? "unavailable" : "…")}
            </span>
          </p>
          <p className="text-xs leading-4 text-text-soft-400">Quota for every AI coding tool, on your desktop.</p>
        </div>
      </header>

      <SettingsSection title="Updates" description="Quotio for Windows and Linux is in preview." className="gap-1">
        <div className="flex items-center gap-3 rounded-2xl border border-stroke-soft-200 p-4">
          <IconTile icon={RiDownloadCloud2Line} />
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-sm leading-5 font-medium text-text-strong-950">Updates are manual for now</span>
            <span className="text-xs leading-4 text-text-sub-600">Download new versions from the Quotio releases page.</span>
          </div>
          <button
            type="button"
            onClick={() => openUrl(`${REPOSITORY}/releases`)}
            className="flex cursor-pointer items-center gap-1 text-sm leading-5 font-medium text-text-sub-600 hover:text-text-strong-950"
          >
            Releases
            <RiArrowRightUpLine className="size-3.5" />
          </button>
        </div>
        <SettingsRow label="Check for updates automatically" help="Takes effect when in-app updates arrive.">
          <Switch
            aria-label="Check for updates automatically"
            checked={autoCheckUpdates}
            onCheckedChange={(on) => updatePreferences((preferences) => ({ ...preferences, autoCheckUpdates: on }))}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Project" description="Quotio is open source." className="grid grid-cols-3 gap-3">
        {links.map(({ title, help, url, icon: Icon, sponsor }) => (
          <button
            key={url}
            type="button"
            onClick={() => openUrl(url)}
            className={cn(
              "flex cursor-pointer flex-col gap-3 rounded-2xl border p-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              sponsor
                ? "border-[#ffd6de] bg-[#fff0f3] hover:bg-[#ffe5ea] dark:border-[#e5484d40] dark:bg-[#e5484d1a] dark:hover:bg-[#e5484d26]"
                : "border-stroke-soft-200 hover:bg-bg-weak-50",
            )}
          >
            <span className="flex justify-between">
              <Icon className={cn("size-5", sponsor ? "text-[#e5484d]" : "text-text-strong-950")} />
              <RiArrowRightUpLine className="size-4 text-text-soft-400" />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-sm leading-5 font-medium text-text-strong-950">{title}</span>
              <span className="text-xs leading-4 text-text-sub-600">{help}</span>
            </span>
          </button>
        ))}
      </SettingsSection>
    </>
  );
}
