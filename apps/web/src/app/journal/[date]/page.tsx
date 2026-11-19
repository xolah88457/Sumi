"use client";
import { AiRecap } from "@/components/ai-recap";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Suspense, use, useRef, useState } from "react";
import type { IntradayPoint, TradeMetrics } from "@luxalgo/journal-core";
import { EquityArea } from "@/components/charts/equity-area";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { Pnl } from "@/components/pnl";
import { MonetaryValue } from "@/components/privacy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { Skeleton } from "@/components/ui/skeleton";
import { RichEditor, type RichEditorHandle } from "@/components/rich-editor";
import { Attachments } from "@/components/attachments";
import { DailyReportExport } from "@/components/daily-report-export";
import { useAutosave } from "@/lib/use-autosave";
import { postJson, useApi } from "@/lib/use-api";
import { fmtMoney, fmtNumber, fmtPercent } from "@/lib/utils";

interface TradeRowLite {
  key: string;
  symbol: string;
  direction: string;
  status: string;
  netPnl: number;
  quantity: number;
  avgEntry: number;
  avgExit: number | null;
  fees: number;
}

interface DayPayload {
  date: string;
  metrics: TradeMetrics;
  trades: TradeRowLite[];
  intraday: IntradayPoint[];
  note: string;
}

export default function JournalDayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = use(params);
  return (
    <Suspense>
      <JournalDay key={date} date={date} />
    </Suspense>
  );
}

function JournalDay({ date }: { date: string }) {
  const { query, values: filters, timeZone } = useFilters();
  const { data, error, refresh } = useApi<DayPayload>(`/api/journal/${date}?${query}`);
  const [resetKey, setResetKey] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const noteEditor = useRef<RichEditorHandle>(null);
  const { save, status: saving, flush } = useAutosave(`/api/journal/${date}`, "PUT");
  const noteValue = note ?? data?.note ?? "";
  const latestNote = useRef(noteValue);
  latestNote.current = noteValue;
  const scheduleSave = (value: string) => {
    latestNote.current = value;
    setNote(value);
    save({ note: value });
  };

  const deleteJournal = async () => {
    if (
      !confirm(
        `Delete the journal for ${date}? The day note and its attachments are removed. Trades on this day are kept. This cannot be undone.`,
      )
    )
      return;
    setDeleting(true);
    setDeleteError("");
    try {
      // Let any queued autosave finish first so it can't write the note back afterwards.
      await flush();
      await postJson(`/api/journal/${date}`, undefined, "DELETE");
      latestNote.current = "";
      setNote("");
      setResetKey((key) => key + 1);
      refresh();
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "Couldn’t delete this journal.");
    } finally {
      setDeleting(false);
    }
  };

  const m = data?.metrics;
  // The shared day note is only sent to AI when no account or trade filter narrows the recap.
  const noteInScope = Object.keys(filters).every((key) => key === "from" || key === "to");
  return (
    <div>
      <FilterBar
        title={`Journal · ${date}`}
        lede="Look back over the day, then write what you noticed. Your note saves as you type."
      />
      {m && m.closedTrades > 0 && (
        <div className="px-4 pt-2">
          <KpiStrip
            rowRules
            className="grid-cols-[repeat(auto-fit,minmax(200px,1fr))]"
            aria-label="Day stats"
            items={[
              { id: "net", label: "Net P&L", value: <Pnl value={m.netPnl} /> },
              { id: "trades", label: "Trades", value: m.closedTrades },
              { id: "win", label: "Winrate", value: fmtPercent(m.winRate) },
              { id: "winners", label: "Winners", value: m.wins },
              { id: "losers", label: "Losers", value: m.losses },
              {
                id: "gross",
                label: "Gross",
                value: <MonetaryValue>{fmtMoney(m.grossPnl)}</MonetaryValue>,
              },
              {
                id: "fees",
                label: "Fees",
                value: <MonetaryValue>{fmtMoney(m.fees)}</MonetaryValue>,
              },
              { id: "volume", label: "Volume", value: fmtNumber(m.totalVolume, 0) },
              {
                id: "pf",
                label: "Profit factor",
                value: m.profitFactorIsInfinite
                  ? "∞"
                  : m.profitFactor === null
                    ? "–"
                    : fmtNumber(m.profitFactor),
              },
              {
                id: "expectancy",
                label: "Expectancy",
                value: (
                  <MonetaryValue>
                    {m.expectancy === null ? "–" : fmtMoney(m.expectancy)}
                  </MonetaryValue>
                ),
              },
            ]}
          />
        </div>
      )}
      <div className="grid gap-6 px-4 pb-8 pt-6 xl:grid-cols-5">
        <div className="min-w-0 space-y-5 xl:col-span-2">
          {m && m.closedTrades === 0 && (
            <EmptyState title="No closed trades this day">
              Anything you write in the day note is still kept.
            </EmptyState>
          )}

          {data && data.intraday.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Intraday cumulative net P&L</CardTitle>
              </CardHeader>
              <CardContent>
                <EquityArea
                  data={data.intraday.map((p) => ({
                    t: p.t.slice(11, 16),
                    cumNetPnl: p.cumNetPnl,
                  }))}
                  height={200}
                />
              </CardContent>
            </Card>
          )}

          {data && data.trades.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>Trades</CardTitle>
              </CardHeader>
              <ul className="divide-y divide-border pb-1">
                {data.trades.map((trade) => (
                  <li key={trade.key}>
                    <Link
                      href={`/trades/${encodeURIComponent(trade.key)}?${query}`}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-[15px] transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    >
                      <span className="flex items-center gap-2">
                        <Badge
                          variant={
                            trade.status === "win"
                              ? "profit"
                              : trade.status === "loss"
                                ? "loss"
                                : "secondary"
                          }
                        >
                          {trade.status.toUpperCase()}
                        </Badge>
                        <span className="text-[17px]">{trade.symbol}</span>
                        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                          {trade.direction}
                        </span>
                      </span>
                      <span className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                        <span className="tnum text-[13px] text-muted-foreground">
                          {fmtNumber(trade.quantity, 4)} @{" "}
                          <MonetaryValue>{fmtNumber(trade.avgEntry)}</MonetaryValue>
                          {trade.avgExit !== null && (
                            <>
                              {" "}
                              → <MonetaryValue>{fmtNumber(trade.avgExit)}</MonetaryValue>
                            </>
                          )}
                        </span>
                        <Pnl value={trade.netPnl} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {!data && <Skeleton className="h-64" />}
        </div>

        <Card className="h-fit min-w-0 xl:col-span-3">
          <CardHeader>
            <CardTitle>Day note</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="max-w-[66ch] text-[13px] text-muted-foreground">
              This note is shared across accounts. AI recaps use the selected filters and append a
              labeled section. Shared notes are excluded from filtered AI context.
            </p>
            <div>
              <AiRecap
                key={`${date}:${timeZone}:${query}`}
                date={date}
                filters={filters}
                timeZone={timeZone}
                disabled={!data || (!m?.closedTrades && !(noteInScope && noteValue.trim()))}
                disabledReason={
                  data
                    ? noteInScope
                      ? "AI recap needs a closed trade on this day or something written in the day note."
                      : "No closed trades match these filters on this day. Clear the filters to recap from your day note."
                    : undefined
                }
                beforeRequest={flush}
                onRecap={({ recap, scope }) => {
                  // Append to the current draft, including edits made while AI was running.
                  const section = `## AI recap\n\n${scope.label.replace(/[\\`*_{}\[\]<>#]/g, "").replace(/[\r\n]+/g, " ")}\n\n${recap}`;
                  scheduleSave(
                    latestNote.current ? `${latestNote.current}\n\n---\n\n${section}` : section,
                  );
                }}
              />
            </div>
            {data ? (
              <RichEditor
                key={`note-${resetKey}`}
                editorRef={noteEditor}
                value={noteValue}
                onChange={scheduleSave}
                aiContext={`Daily journal note for ${date}`}
              />
            ) : error ? (
              <p role="alert" className="text-[15px] text-destructive">
                {error}
              </p>
            ) : (
              <Skeleton className="h-48" />
            )}
            <div className="flex flex-wrap items-center justify-between gap-1 text-[13px] text-muted-foreground">
              <span role="status">{saving}</span>
              <span className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => void flush()}>
                  Save now
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={!data || deleting}
                  onClick={() => void deleteJournal()}
                >
                  <Trash2 />
                  {deleting ? "Deleting…" : "Delete journal"}
                </Button>
              </span>
            </div>
            {deleteError && (
              <p role="alert" className="text-[13px] text-destructive">
                {deleteError}
              </p>
            )}
            <DailyReportExport date={date} query={query} note={note !== null ? note : undefined} />
            <Attachments key={`files-${resetKey}`} type="day" id={date} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
