"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import type { DayStats } from "@luxalgo/journal-core";
import { calendarTradeHref, type CalendarResponse } from "@/lib/calendar-insights";
import { cn, fmtMoney, fmtPercent } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { EmptyState } from "./ui/empty-state";
import { KpiStrip } from "./ui/kpi-strip";
import { HelpHint, HoverHint } from "./ui/tooltip";
import { Pnl } from "./pnl";
import { usePrivacy } from "./privacy";
// Keep the calendar and summaries usable before the plotting bundle loads.
const CalendarDailyChart = dynamic(
  () => import("./charts/calendar-daily-chart").then((module) => module.CalendarDailyChart),
  {
    loading: () => (
      <div
        role="status"
        aria-label="Loading daily performance chart"
        className="h-60 rounded-lg bg-muted/20"
      />
    ),
  },
);

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const dateLabel = (date: string) => dateFormatter.format(new Date(`${date}T12:00:00Z`));

function StripLabel({ title, hint }: { title: string; hint: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {title}
      <HelpHint heading={title}>{hint}</HelpHint>
    </span>
  );
}

function Metric({
  title,
  value,
  detail,
  hint,
}: {
  title: string;
  value: ReactNode;
  detail: ReactNode;
  hint: string;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{title}</CardTitle>
        <HelpHint heading={title}>{hint}</HelpHint>
      </CardHeader>
      <CardContent>
        <div className="tnum text-[26px] leading-tight tracking-[-0.02em]">{value}</div>
        <div className="mt-1 text-[13px] text-muted-foreground">{detail}</div>
      </CardContent>
    </Card>
  );
}

export function CalendarPerformance({ data, query }: { data: CalendarResponse; query: string }) {
  const { insights: i, scope, timeZone, currencies } = data;
  const currency = currencies[0] ?? "USD";
  const mixed = currencies.length > 1;
  const privateMode = usePrivacy();
  const router = useRouter();
  const [weekday, setWeekday] = useState<number | null>(null);
  const href = (date?: string) => calendarTradeHref(query, scope, date);
  const money = (value: number | null) =>
    value === null || mixed ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      <Pnl value={value} currency={currency} />
    );
  const selected = weekday === null ? null : i.weekdays[weekday]!;
  const peak = Math.max(1, ...i.weekdays.map((day) => Math.abs(day.netPnl)));
  const dayLink = (day: DayStats | null) =>
    day && !mixed ? (
      <Link
        href={href(day.date)}
        className="inline-flex max-w-full items-center gap-2 rounded text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {money(day.netPnl)}
        <span className="text-[13px] font-normal text-muted-foreground">{dateLabel(day.date)}</span>
        <ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0" />
      </Link>
    ) : (
      money(null)
    );
  return (
    <section
      aria-labelledby="calendar-insights-heading"
      className="space-y-5"
      data-calendar-insights
    >
      <div className="flex flex-wrap items-end justify-between gap-2 pt-4">
        <div>
          <h2 id="calendar-insights-heading" className="text-[21px] font-normal tracking-[-0.02em]">
            Performance insights
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Visible month × active filters · Closed trades, after fees · {timeZone}
          </p>
        </div>
        {i.trades > 0 && (
          <Link
            href={href()}
            className="inline-flex items-center gap-1 rounded text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            View matching trades <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </Link>
        )}
      </div>
      {!i.tradingDays ? (
        <EmptyState title="No closed trades in this view">
          Choose another month or adjust your account and filters. Open positions and days without
          trades aren’t included in performance insights.
        </EmptyState>
      ) : (
        <>
          {mixed && (
            <p
              role="status"
              className="rounded-lg bg-secondary px-4 py-3 text-[15px] text-muted-foreground"
            >
              These trades use {currencies.join(", ")}. Select accounts with one currency to compare
              monetary performance; no exchange-rate conversion is applied.
            </p>
          )}
          <KpiStrip
            aria-label="Month summary"
            items={[
              {
                id: "net",
                label: (
                  <StripLabel
                    title="Net P&L"
                    hint="Sum of net P&L for closed trades in this month and filter selection. Includes fees. No currency conversion."
                  />
                ),
                value: money(i.netPnl),
                detail: `${i.tradingDays} trading day${i.tradingDays === 1 ? "" : "s"}${mixed ? "" : ` · ${currency}`}`,
              },
              {
                id: "avg",
                label: (
                  <StripLabel
                    title="Average daily P&L"
                    hint="Net P&L divided by trading days. Days without closed trades are excluded; break-even trading days are included."
                  />
                ),
                value: money(i.avgDailyPnl),
                detail: "Per day with closed trades",
              },
              {
                id: "win",
                label: (
                  <StripLabel
                    title="Trade win rate"
                    hint="Winning closed trades divided by all closed trades, including break-even trades. Uses your journal's configured break-even rule."
                  />
                ),
                value: fmtPercent(i.winRate),
                detail: `${i.wins} wins · ${i.losses} losses · ${i.breakevens} break-even`,
              },
              {
                id: "trades",
                label: (
                  <StripLabel
                    title="Total closed trades"
                    hint="Counts completed trades whose closing day falls in the visible month and selected date range, with all other filters applied."
                  />
                ),
                value: (
                  <Link
                    className="rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    href={href()}
                  >
                    {i.trades}
                  </Link>
                ),
                detail: "Round-trip trades, not executions",
              },
            ]}
          />
          {!mixed && (
            <>
              <div className="grid gap-5 md:grid-cols-3">
                <Card>
                  <CardHeader>
                    <CardTitle>Best & worst day</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="text-[13px] text-muted-foreground">Best day</span>
                      {dayLink(i.bestDay)}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="text-[13px] text-muted-foreground">Worst day</span>
                      {dayLink(i.worstDay)}
                    </div>
                    <p className="text-[13px] text-muted-foreground">
                      {i.tradingDays === 1
                        ? "One trading day; both extrema are the same."
                        : "Highest and lowest daily net P&L."}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Average green & red day</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-[13px] text-muted-foreground">
                        {i.greenDays} profitable days
                      </span>
                      {money(i.avgGreenDay)}
                    </div>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-[13px] text-muted-foreground">
                        {i.redDays} losing days
                      </span>
                      {money(i.avgRedDay)}
                    </div>
                    <p className="text-[13px] text-muted-foreground">
                      Each average uses only its own group.
                    </p>
                  </CardContent>
                </Card>
                <Metric
                  title="Day consistency"
                  value={fmtPercent(i.profitableDayRate)}
                  detail={`${i.greenDays} positive · ${i.redDays} negative · ${i.flatDays} flat days`}
                  hint="Share of trading days with strictly positive net P&L. This is a profitable-day rate, not a risk-adjusted score or a prediction. Flat days stay in the denominator."
                />
              </div>
              <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
                <Card>
                  <CardHeader>
                    <h3 className="text-[15px] font-medium">Daily performance</h3>
                    <p className="text-[13px] text-muted-foreground">
                      Net P&L by closing day · {currency}
                      {i.tradingDays >= 8 ? " · Dashed line: 5-trading-day average" : ""}
                    </p>
                  </CardHeader>
                  <CardContent>
                    {i.tradingDays >= 2 ? (
                      <CalendarDailyChart
                        data={i.trend}
                        currency={currency}
                        onInspect={(date) => router.push(href(date))}
                      />
                    ) : (
                      <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg bg-muted/30 p-5 text-center">
                        <span className="text-sm font-medium">A trend needs more than one day</span>
                        <span className="text-[13px] text-muted-foreground">
                          {dateLabel(i.days[0]!.date)} · {money(i.netPnl)} · {i.trades} closed
                          trades
                        </span>
                        <span className="text-[13px] text-muted-foreground">
                          Explore an earlier month with more trading history.
                        </span>
                      </div>
                    )}
                    <details className="mt-3 border-t pt-3">
                      <summary className="cursor-pointer rounded text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                        Daily values & trade links ({i.tradingDays})
                      </summary>
                      <div className="mt-2 max-h-60 overflow-auto">
                        <table className="w-full text-left text-[13px]">
                          <caption className="sr-only">
                            Daily results for the current month and filters
                          </caption>
                          <thead className="sticky top-0 bg-card text-muted-foreground">
                            <tr>
                              <th scope="col" className="py-2 font-medium">
                                Closing day
                              </th>
                              <th scope="col" className="text-right font-medium">
                                Trades
                              </th>
                              <th scope="col" className="text-right font-medium">
                                Net P&L
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {i.days.map((day) => (
                              <tr key={day.date} className="border-t">
                                <th scope="row" className="py-2 font-normal">
                                  <Link
                                    href={href(day.date)}
                                    className="rounded underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  >
                                    {dateLabel(day.date)}
                                  </Link>
                                </th>
                                <td className="text-right tabular-nums">{day.trades}</td>
                                <td className="text-right">{money(day.netPnl)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <h3 className="text-[15px] font-medium">Performance by weekday</h3>
                    <p className="text-[13px] text-muted-foreground">
                      Closing-day net P&L · {currency} · Select a row
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-3 rounded-lg bg-secondary px-3 py-2">
                      <div className="text-[13px] text-muted-foreground">
                        Most profitable weekday
                      </div>
                      <div className="mt-0.5 flex flex-wrap justify-between gap-1 text-sm font-medium">
                        {i.mostProfitableWeekday ? (
                          <>
                            <span>{i.mostProfitableWeekday.label}</span>
                            {money(i.mostProfitableWeekday.netPnl)}
                          </>
                        ) : (
                          <span className="text-muted-foreground">No profitable weekday yet</span>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1">
                      {i.weekdays.map((day) => (
                        <HoverHint
                          key={day.index}
                          heading={day.label}
                          content={`${day.days.length} trading days · ${day.trades} closed trades · ${privateMode ? "P&L hidden" : fmtMoney(day.netPnl, currency)}`}
                        >
                          <button
                            type="button"
                            disabled={!day.trades}
                            onClick={() => setWeekday(weekday === day.index ? null : day.index)}
                            aria-pressed={weekday === day.index}
                            aria-label={`${day.label}: ${day.trades} trades${privateMode ? "" : `, ${fmtMoney(day.netPnl, currency)}`}. Inspect closing days.`}
                            className={cn(
                              "grid w-full grid-cols-[2rem_minmax(0,1fr)_5.75rem] items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:hover:bg-transparent",
                              weekday === day.index && "bg-accent",
                            )}
                          >
                            <span>{day.label.slice(0, 3)}</span>
                            <span aria-hidden="true" className="relative h-4">
                              <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
                              <span
                                className={cn(
                                  "absolute top-1 h-2 rounded-sm",
                                  day.netPnl > 0
                                    ? "bg-profit"
                                    : day.netPnl < 0
                                      ? "bg-loss"
                                      : "bg-muted-foreground",
                                )}
                                style={{
                                  left:
                                    day.netPnl < 0
                                      ? `${50 - (Math.abs(day.netPnl) / peak) * 50}%`
                                      : "50%",
                                  width:
                                    day.netPnl === 0
                                      ? "2px"
                                      : `${(Math.abs(day.netPnl) / peak) * 50}%`,
                                }}
                              />
                            </span>
                            <span className="text-right">
                              {day.trades ? money(day.netPnl) : "—"}
                            </span>
                          </button>
                        </HoverHint>
                      ))}
                    </div>
                    {selected && (
                      <div className="mt-3 border-t pt-3" aria-live="polite">
                        <p className="mb-2 text-[13px] font-medium">
                          {selected.label} · {selected.trades} trades across {selected.days.length}{" "}
                          days
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {selected.days.map((day) => (
                            <Link
                              key={day.date}
                              href={href(day.date)}
                              className="rounded-md border px-2 py-1.5 text-[13px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {dateLabel(day.date)}{" "}
                              <span className="text-muted-foreground">· {day.trades} trades</span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
              {i.tradingDays < 5 && (
                <p className="px-1 text-[13px] text-muted-foreground">
                  Small sample: {i.tradingDays} trading day{i.tradingDays === 1 ? "" : "s"}. Weekday
                  results and consistency describe this selection only.
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
