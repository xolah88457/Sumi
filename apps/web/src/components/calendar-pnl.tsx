"use client";
import { HoverHint } from "./ui/tooltip";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { CalendarMonth } from "@luxalgo/journal-core";
import { cn, fmtMoney } from "@/lib/utils";
import { Pnl } from "./pnl";
import { MonetaryValue, usePrivacy } from "./privacy";
import type { CalendarPnlPoint } from "@/lib/calendar-insights";
import { CalendarDayPreview } from "./calendar-day-preview";

const compactFormatters = new Map<string, Intl.NumberFormat>();
const compactMoney = (value: number, currency: string) => {
  let formatter = compactFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
      signDisplay: "exceptZero",
    });
    compactFormatters.set(currency, formatter);
  }
  return formatter.format(value);
};

/**
 * The P&L calendar — an HTML grid, not a chart. Each traded day prints a ▲/▼ glyph,
 * its signed P&L and trade count; a soft background tint scales with magnitude
 * (lightness carries magnitude, which survives CVD; the glyph and number carry sign).
 */
export function CalendarPnl({
  calendar,
  currency = "USD",
  monetary = true,
  runningPnl,
}: {
  calendar: CalendarMonth;
  currency?: string;
  monetary?: boolean;
  runningPnl?: Record<string, CalendarPnlPoint[]>;
}) {
  const maxAbs = Math.max(
    1,
    ...calendar.weeks.flatMap((week) => week.days.map((day) => Math.abs(day?.netPnl ?? 0))),
  );
  return (
    <div className="journal-calendar min-w-0 w-full">
      <div className="journal-calendar-grid grid gap-1.5 text-[13px]">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((weekday) => (
          <div key={weekday} className="px-1 pb-1 text-muted-foreground">
            {weekday}
          </div>
        ))}
        <div className="journal-calendar-week-heading px-1 pb-1 text-right text-muted-foreground">
          Week
        </div>
        {calendar.weeks.map((week, weekIndex) => (
          <CalendarWeekRow
            key={weekIndex}
            week={week}
            maxAbs={maxAbs}
            currency={currency}
            monetary={monetary}
            runningPnl={runningPnl}
          />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[15px]">
        <span className="text-muted-foreground">
          {calendar.tradingDays} trading days {monetary && <>· {calendar.winningDays} profitable</>}
        </span>
        <span>
          Month:{" "}
          {monetary ? (
            <Pnl value={calendar.monthNetPnl} currency={currency} className="font-semibold" />
          ) : (
            <span className="text-muted-foreground">Multiple currencies</span>
          )}
        </span>
      </div>
    </div>
  );
}

/** ▲ for a profit and ▼ for a loss, so the sign never depends on tint alone. */
function DayGlyph({ value }: { value: number }) {
  if (value === 0) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "journal-calendar-glyph mr-0.5 text-[0.7em]",
        value > 0
          ? "text-[color-mix(in_srgb,var(--profit)_60%,var(--foreground))]"
          : "text-[color-mix(in_srgb,var(--loss)_60%,var(--foreground))]",
      )}
    >
      {value > 0 ? "▲" : "▼"}
    </span>
  );
}

function CalendarWeekRow({
  week,
  maxAbs,
  currency,
  monetary,
  runningPnl,
}: {
  week: CalendarMonth["weeks"][number];
  maxAbs: number;
  currency: string;
  monetary: boolean;
  runningPnl?: Record<string, CalendarPnlPoint[]>;
}) {
  const search = useSearchParams();
  const privacy = usePrivacy();
  return (
    <>
      {week.days.map((day, dayIndex) => {
        if (!day) return <div key={dayIndex} className="journal-calendar-day rounded-lg" />;
        const traded = day.trades > 0;
        // Soft tint: 6% to 20% of the signal colour over the card surface.
        const intensity = traded ? 0.06 + 0.14 * (Math.abs(day.netPnl) / maxAbs) : 0;
        const performance = !monetary
          ? "neutral"
          : day.netPnl > 0
            ? "profit"
            : day.netPnl < 0
              ? "loss"
              : "neutral";
        return (
          <HoverHint
            key={day.date}
            heading={day.date}
            content={
              runningPnl ? (
                <CalendarDayPreview
                  points={runningPnl[day.date] ?? []}
                  total={day.netPnl}
                  trades={day.trades}
                  currency={currency}
                  monetary={monetary}
                />
              ) : (
                `${!monetary ? "Multiple currencies" : privacy ? "P&L hidden" : fmtMoney(day.netPnl, currency)} · ${day.trades} trades`
              )
            }
          >
            <Link
              key={day.date}
              href={`/journal/${day.date}?${search}`}
              aria-label={`${day.date}, ${!monetary ? "Multiple currencies" : privacy ? "P&L hidden" : fmtMoney(day.netPnl, currency)}, ${day.trades} trades`}
              className={cn(
                "journal-calendar-day journal-calendar-day-link min-w-0 rounded-lg border",
                !traded && "border-transparent bg-muted/60",
              )}
              data-performance={performance}
              style={
                traded && monetary
                  ? {
                      backgroundColor: `color-mix(in oklab, ${
                        performance === "profit"
                          ? "var(--profit-fill)"
                          : performance === "loss"
                            ? "var(--loss)"
                            : "var(--neutral-mid)"
                      } ${Math.round(intensity * 100)}%, var(--card))`,
                    }
                  : undefined
              }
            >
              <div
                className={cn(
                  "journal-calendar-date-number",
                  traded ? "text-foreground/75" : "text-muted-foreground",
                )}
              >
                {Number(day.date.slice(8))}
              </div>
              {traded && (
                <>
                  <div className="journal-calendar-full tnum font-medium">
                    {monetary ? (
                      <>
                        <DayGlyph value={day.netPnl} />
                        <MonetaryValue>{fmtMoney(day.netPnl, currency)}</MonetaryValue>
                      </>
                    ) : (
                      "—"
                    )}
                  </div>
                  <div className="journal-calendar-compact tnum font-medium">
                    {monetary ? (
                      <>
                        <DayGlyph value={day.netPnl} />
                        <MonetaryValue>{compactMoney(day.netPnl, currency)}</MonetaryValue>
                      </>
                    ) : (
                      "—"
                    )}
                  </div>
                  <div className="journal-calendar-trades text-foreground/75">
                    {day.trades} trade{day.trades === 1 ? "" : "s"}
                  </div>
                </>
              )}
            </Link>
          </HoverHint>
        );
      })}
      <div className="journal-calendar-week flex rounded-lg p-1.5">
        <span className="journal-calendar-week-label text-muted-foreground">Week total</span>
        {week.weekTrades > 0 ? (
          <>
            {monetary && (
              <Pnl value={week.weekNetPnl} currency={currency} className="font-medium" />
            )}
            <span className="text-muted-foreground">{week.weekTrades} trades</span>
          </>
        ) : (
          <span className="text-muted-foreground">–</span>
        )}
      </div>
    </>
  );
}
