import { useEffect, useState } from "react";
import { usePreferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";

const REVEAL_MS = 3_000;

/** Account names and emails; blurred while "Hide account names" is on, revealed briefly on click. */
export function SensitiveText({ children, className }: { children: string; className?: string }) {
  const { hideAccountNames } = usePreferences();
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!revealed) return;
    const timer = setTimeout(() => setRevealed(false), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [revealed]);

  if (!hideAccountNames) return <span className={className}>{children}</span>;
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={revealed ? children : "Hidden account name. Activate to reveal."}
      onClick={() => setRevealed(true)}
      onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && setRevealed(true)}
      className={cn("cursor-pointer transition-[filter] select-none", !revealed && "blur-[5px]", className)}
    >
      {children}
    </span>
  );
}
