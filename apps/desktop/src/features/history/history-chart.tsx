import { useState, type PointerEvent } from "react";
import { formatClock } from "@/features/accounts/format";
import type { HistoryView, Point } from "./model";

// Hand-rolled SVG: the chart needs observation gaps, a dashed projection past "now" and reset bands,
// which a charting library would need overriding for, at the cost of a large new dependency.
const WIDTH = 1000;
const HEIGHT = 180;

export function HistoryChart({ view, selected, onSelect }: { view: HistoryView; selected: Point | null; onSelect: (point: Point | null) => void }) {
  const span = view.end - view.start;
  const x = (time: number) => ((time - view.start) / span) * WIDTH;
  const y = (percent: number) => (1 - percent / 100) * HEIGHT;
  const percentX = (time: number) => `${((time - view.start) / span) * 100}%`;
  const [hovering, setHovering] = useState(false);

  const nowX = x(Math.min(view.now, view.end));
  const { resetInView: resetAt, projection } = view;
  const firstGap = view.gaps.find((gap) => gap.to - gap.from > span * 0.08);

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const time = view.start + ((event.clientX - box.left) / box.width) * span;
    let nearest: Point | null = null;
    for (const segment of view.segments) {
      for (const point of segment) {
        if (point.percent !== null && (!nearest || Math.abs(point.at - time) < Math.abs(nearest.at - time))) nearest = point;
      }
    }
    onSelect(nearest);
    setHovering(true);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <div className="flex h-[180px] w-8 shrink-0 flex-col justify-between text-[11px] text-text-soft-400">
          <span>100%</span>
          <span>50%</span>
          <span>0%</span>
        </div>
        <div
          className="relative h-[180px] flex-1"
          onPointerMove={pick}
          onPointerLeave={() => {
            setHovering(false);
            onSelect(null);
          }}
        >
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
            {[0, 50, 100].map((percent) => (
              <line key={percent} x1={0} x2={WIDTH} y1={y(percent)} y2={y(percent)} className="stroke-stroke-soft-200" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
            ))}
            {view.gaps.map((gap) => (
              <rect key={gap.from} x={x(gap.from)} width={Math.max(0, x(gap.to) - x(gap.from))} y={0} height={HEIGHT} className="fill-bg-weak-50" />
            ))}
            {view.events
              .filter((event) => event.tone === "reset")
              .map((event) => (
                <rect key={event.id} x={x(event.from)} width={Math.max(2, x(event.to) - x(event.from))} y={0} height={HEIGHT} className="fill-primary-base/15" />
              ))}
            {resetAt !== null && (
              <line x1={x(resetAt)} x2={x(resetAt)} y1={0} y2={HEIGHT} className="stroke-primary-base/50" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
            )}
            {view.segments.map((segment) => {
              const known = segment.filter((point): point is Point & { percent: number } => point.percent !== null);
              const [first] = known;
              if (!first) return null;
              // A lone observation spans its bin so it stays visible.
              const vertices: [number, number][] =
                known.length === 1
                  ? [
                      [Date.parse(first.bin.start_at), first.percent],
                      [Date.parse(first.bin.end_at), first.percent],
                    ]
                  : known.map((point) => [point.at, point.percent]);
              const line = vertices.map(([time, percent], index) => `${index === 0 ? "M" : "L"}${x(time)},${y(percent)}`).join(" ");
              const area = `${line} V${HEIGHT} H${x(vertices[0]?.[0] ?? first.at)} Z`;
              return (
                <g key={segment[0].bin.id}>
                  <path d={area} className="fill-primary-base/10" />
                  <path d={line} fill="none" className="stroke-primary-base" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                </g>
              );
            })}
            {projection && (
              <line
                x1={x(projection.from.at)}
                y1={y(projection.from.percent)}
                x2={x(projection.to.at)}
                y2={y(projection.to.percent)}
                className="stroke-primary-base"
                strokeWidth={2}
                strokeDasharray="5 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
            <line x1={nowX} x2={nowX} y1={0} y2={HEIGHT} className="stroke-text-soft-400" vectorEffect="non-scaling-stroke" />
            {selected?.percent != null && hovering && (
              <line x1={x(selected.at)} x2={x(selected.at)} y1={0} y2={HEIGHT} className="stroke-text-strong-950" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
          {selected?.percent != null && hovering && (
            <span
              className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg-white-0 bg-primary-base"
              style={{ left: percentX(selected.at), top: y(selected.percent) }}
            />
          )}
          {firstGap && (
            <span
              className="absolute top-[6%] rounded-[5px] bg-bg-white-0 px-1.5 py-0.5 text-[10px] font-medium text-text-sub-600 shadow-[0_0_0_1px_rgba(23,23,23,0.06)]"
              style={{ left: percentX(firstGap.from) }}
            >
              Not observed
            </span>
          )}
          {resetAt !== null && (
            <span
              className="absolute bottom-[4%] -translate-x-full rounded-[5px] bg-alpha-primary-10 px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-primary-base"
              style={{ left: percentX(resetAt) }}
            >
              Reset {formatClock(new Date(resetAt))}
            </span>
          )}
        </div>
      </div>
      <XAxis view={view} />
    </div>
  );
}

function XAxis({ view }: { view: HistoryView }) {
  const span = view.end - view.start;
  const daily = span > 2 * 86_400_000;
  const ticks = roundTicks(view.start, view.end);
  const nowFraction = (view.now - view.start) / span;
  return (
    <div className="relative ml-10 h-4 text-[11px] text-text-soft-400">
      {ticks.map((time) => {
        const fraction = (time - view.start) / span;
        // The "Now" label wins where a tick would collide with it.
        if (Math.abs(fraction - nowFraction) < 0.1) return null;
        return (
          <span key={time} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${fraction * 100}%` }}>
            {daily ? new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : formatClock(new Date(time))}
          </span>
        );
      })}
      {nowFraction <= 1 && (
        <span className="absolute -translate-x-1/2 font-semibold text-text-strong-950" style={{ left: `${nowFraction * 100}%` }}>
          Now
        </span>
      )}
    </div>
  );
}

const HOUR = 3_600_000;
const tickSteps = [HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, 24 * HOUR, 2 * 24 * HOUR, 7 * 24 * HOUR];

/** At most five ticks on whole local hours or days, inset from the edges so labels stay inside. */
function roundTicks(start: number, end: number): number[] {
  const step = tickSteps.find((candidate) => (end - start) / candidate <= 5) ?? 7 * 24 * HOUR;
  const first = new Date(start);
  if (step >= 24 * HOUR) first.setHours(24, 0, 0, 0);
  else first.setHours(Math.ceil((first.getHours() + 1) / (step / HOUR)) * (step / HOUR), 0, 0, 0);
  const inset = (end - start) * 0.05;
  const ticks: number[] = [];
  for (let time = first.getTime(); time < end - inset; time += step) if (time > start + inset) ticks.push(time);
  return ticks;
}
