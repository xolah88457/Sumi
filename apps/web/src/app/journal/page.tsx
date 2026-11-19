"use client";

import Link from "next/link";
import { dayKeyOf } from "@luxalgo/journal-core";
import { Suspense, useEffect, useState } from "react";
import { NotebookPen } from "lucide-react";
import type { DayStats } from "@luxalgo/journal-core";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { Pnl } from "@/components/pnl";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadError } from "@/components/load-error";
import { Button } from "@/components/ui/button";
import Loading from "@/app/loading";
import { useApi } from "@/lib/use-api";
import { fmtPercent } from "@/lib/utils";

interface JournalDay {
  date: string;
  stats: DayStats | null;
  hasNote: boolean;
  notePreview: string;
}

const PAGE_SIZE = 50;
const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  timeZone: "UTC",
});

export default function JournalPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Journal />
    </Suspense>
  );
}

function Journal() {
  const { query, timeZone } = useFilters();
  const { data, error, refresh } = useApi<{ days: JournalDay[] }>(`/api/journal?${query}`);
  // Reset the visible window immediately when filters change. Keep every day
  // available without mounting years of cards on the first render.
  const [visibleWindow, setVisibleWindow] = useState({ query, limit: PAGE_SIZE });
  const limit = visibleWindow.query === query ? visibleWindow.limit : PAGE_SIZE;
  useEffect(() => setVisibleWindow({ query, limit: PAGE_SIZE }), [query]);

  const days = data?.days ?? [];
  const tradedDays = days.filter((day) => day.stats && day.stats.trades > 0);
  const greenDays = tradedDays.filter((day) => (day.stats?.netPnl ?? 0) > 0).length;

  return (
    <div>
      <FilterBar
        title="Daily journal"
        lede="One entry for each trading day. Open a day to read your note or write one."
        actions={
          <Button asChild size="sm">
            <Link href={`/journal/${dayKeyOf(new Date().toISOString(), timeZone)}?${query}`}>
              View my day
            </Link>
          </Button>
        }
      />
      <div className="space-y-5 px-4 pb-8">
        {error ? (
          <LoadError message={error} onRetry={refresh} />
        ) : !data ? (
          <div role="status" aria-label="Loading journal">
            <Skeleton className="h-48" />
          </div>
        ) : null}
        {data && days.length > 0 && (
          <KpiStrip
            aria-label="Journal summary"
            items={[
              { id: "days", label: "Days in this view", value: days.length },
              {
                id: "notes",
                label: "Days with a note",
                value: days.filter((day) => day.hasNote).length,
              },
              {
                id: "green",
                label: "Green days",
                value: fmtPercent(tradedDays.length ? greenDays / tradedDays.length : null, 0),
                detail: `${greenDays} of ${tradedDays.length} trading days`,
              },
            ]}
          />
        )}
        {data?.days.length === 0 && (
          <EmptyState
            title="No trading days yet"
            action={
              <Button asChild variant="outline">
                <Link href="/import">Import trades</Link>
              </Button>
            }
          >
            Import trades, or open today and write your first day note.
          </EmptyState>
        )}
        {days.length > 0 && (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border">
              {days.slice(0, limit).map((day) => (
                <li key={day.date}>
                  <Link
                    href={`/journal/${day.date}?${query}`}
                    className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  >
                    <div className="w-full shrink-0 sm:w-36">
                      <div className="tnum text-[17px] leading-tight">{day.date}</div>
                      <div className="text-[13px] text-muted-foreground">
                        {weekdayFormatter.format(new Date(`${day.date}T00:00:00Z`))}
                      </div>
                    </div>
                    {day.stats ? (
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-1 text-[15px]">
                        <Pnl value={day.stats.netPnl} className="w-28 text-[17px]" />
                        <span className="tnum text-muted-foreground">
                          {day.stats.trades} trade{day.stats.trades === 1 ? "" : "s"}
                        </span>
                        <span className="tnum text-muted-foreground">
                          {fmtPercent(
                            day.stats.trades > 0 ? day.stats.wins / day.stats.trades : null,
                            0,
                          )}{" "}
                          win
                        </span>
                        <span className="tnum text-muted-foreground">
                          {day.stats.wins}W / {day.stats.losses}L
                        </span>
                      </div>
                    ) : (
                      <div className="flex-1 text-[15px] text-muted-foreground">No trades</div>
                    )}
                    {day.hasNote && (
                      <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                        <NotebookPen aria-hidden="true" className="size-3.5" />
                        note
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {data && data.days.length > PAGE_SIZE && (
          <div className="flex flex-wrap items-center justify-between gap-3 py-2 text-[13px] text-muted-foreground">
            <span role="status">
              Showing {Math.min(limit, data.days.length)} of {data.days.length} days
            </span>
            {limit < data.days.length && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVisibleWindow({ query, limit: limit + PAGE_SIZE })}
              >
                Show older days
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
