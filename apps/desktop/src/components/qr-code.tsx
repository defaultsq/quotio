import { useMemo } from "react";
import { encode } from "uqr";
import { cn } from "@/lib/utils";

/** Always dark on white, whatever the theme: phone cameras read inverted codes poorly. */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const { data, size } = encode(value, { ecc: "L", border: 2 });
    const path = data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : []))).join("");
    return { size, path };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={cn("rounded-xl bg-white", className)}
    >
      <path d={path} fill="#000" />
    </svg>
  );
}
