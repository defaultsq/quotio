import { cn } from "@/lib/utils";
import type { ProviderView } from "@/features/accounts/model";

// Logos are the macOS ProviderIcons set, keyed by the host's `icon` name and drawn with currentColor.
const logos = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("../assets/provider-icons/*.svg", { eager: true, query: "?url", import: "default" }),
  ).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1, -".svg".length), url]),
);

// Brand tints from the design; other logos use the strong text colour.
const tints: Record<string, string> = { claude: "#d97757", gemini: "var(--primary-base-2)" };

export function ProviderLogo({ provider, className }: { provider: ProviderView; className?: string }) {
  const url = provider.icon ? logos[provider.icon] : undefined;
  if (!url) {
    return (
      <span
        aria-hidden
        className={cn(
          "grid size-[18px] shrink-0 place-items-center rounded-[5px] bg-bg-weak-50 text-[10px] font-semibold text-text-sub-600",
          className,
        )}
      >
        {provider.name.charAt(0).toUpperCase()}
      </span>
    );
  }
  const mask = `url("${url}") center / contain no-repeat`;
  return (
    <span
      aria-hidden
      className={cn("block size-[18px] shrink-0", className)}
      style={{ backgroundColor: tints[provider.id] ?? "var(--text-strong-950)", mask, WebkitMask: mask }}
    />
  );
}
