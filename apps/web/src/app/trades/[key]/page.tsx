"use client";
import { Checkbox } from "@/components/ui/checkbox";

import { use, useRef, useState } from "react";
import { netReturnOnEntry } from "@luxalgo/journal-core";
import { FilterBar } from "@/components/filter-bar";
import { Pnl } from "@/components/pnl";
import { MonetaryValue, MonetaryField } from "@/components/privacy";
import { Attachments } from "@/components/attachments";
import { TradeNavigation } from "@/components/trade-navigation";
import { DeleteTradeButton } from "@/components/delete-trade-button";
import { TradeRating } from "@/components/trade-rating";
import { EquityArea } from "@/components/charts/equity-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { KpiStrip } from "@/components/ui/kpi-strip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TradeOutcomeControls } from "@/components/trade-outcome-controls";
import { TradeCritiqueSection } from "@/components/ai-critique";
import { RichEditor, type RichEditorHandle } from "@/components/rich-editor";
import { ReportExport } from "@/components/daily-report-export";
import { RuleChecklist } from "@/components/rule-checklist";
import { useAutosave } from "@/lib/use-autosave";
import { postJson, useApi } from "@/lib/use-api";
import { fmtDuration, fmtMoney, fmtNumber, fmtPercent } from "@/lib/utils";
import { tradeKeyFromSegment } from "@/lib/trade-links";
import { formatTimestamp } from "@/lib/timezone";
import { hitTradeTarget } from "@/lib/trade-targets";

interface TradeDetail {
  riskAmount: number | null;
  realizedR: number | null;
  plannedR: number | null;
  contractMultiplier: number | null;
  currency: string;
  key: string;
  accountId: string;
  symbol: string;
  assetClass: string | null;
  direction: "long" | "short";
  status: string;
  openedAt: string;
  closedAt: string | null;
  quantity: number;
  openQuantity: number;
  avgEntry: number;
  avgExit: number | null;
  grossPnl: number;
  fees: number;
  netPnl: number;
  durationMs: number | null;
  exitsJson: string;
  notes: string | null;
  tagsJson: string | null;
  mistakesJson: string | null;
  playbookId: string | null;
  rating: number | null;
  stopLoss: number | null;
  profitTarget: number | null;
  reviewedAt: string | null;
}

interface ExecutionRow {
  id: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number;
  executedAt: string;
}

export default function TradePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const tradeKey = tradeKeyFromSegment(key);
  return <TradeView key={tradeKey} tradeKey={tradeKey} />;
}

function TradeView({ tradeKey }: { tradeKey: string }) {
  const { data, error, refresh } = useApi<{
    trade: TradeDetail;
    executions: ExecutionRow[];
    timeZone: string;
  }>(`/api/trades/${encodeURIComponent(tradeKey)}`);
  const { data: accountsData } = useApi<{
    accounts: { id: string; name: string; kind: string }[];
  }>("/api/accounts");
  const isManualAccount =
    accountsData?.accounts.find((a) => a.id === data?.trade.accountId)?.kind === "manual";

  if (!data) {
    return (
      <div>
        <FilterBar title="Trade" />
        <div className="px-4 pb-8">
          {error ? (
            <p role="alert" className="text-[15px] text-destructive">
              {error}
            </p>
          ) : (
            <Skeleton className="h-96" />
          )}
        </div>
      </div>
    );
  }
  const { trade, executions, timeZone } = data;

  const patch = async (body: Record<string, unknown>) => {
    if (Object.keys(body).length)
      await postJson(`/api/trades/${encodeURIComponent(tradeKey)}`, body, "PATCH");
    refresh();
  };

  const runningPnl = (() => {
    const exits = JSON.parse(trade.exitsJson) as {
      executionId: string;
      grossPnl: number;
      quantity: number;
    }[];
    const times = new Map(executions.map((e) => [e.id, e.executedAt]));
    const totalExitQty = exits.reduce((total, exit) => total + exit.quantity, 0);
    let cum = 0;
    return exits
      .map((exit) => ({
        t: times.get(exit.executionId) ?? trade.openedAt,
        pnl: exit.grossPnl - (totalExitQty > 0 ? trade.fees * (exit.quantity / totalExitQty) : 0),
      }))
      .sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
      .map((event) => ({
        t: formatTimestamp(event.t, timeZone).slice(11, 16),
        cumNetPnl: (cum += event.pnl),
      }));
  })();

  return (
    <div>
      <FilterBar
        title={`${trade.symbol} · ${trade.direction.toUpperCase()}`}
        lede={`${formatTimestamp(trade.openedAt, timeZone)} to ${trade.closedAt ? formatTimestamp(trade.closedAt, timeZone) : "now (still open)"}, shown in ${timeZone}.`}
      />
      <TradeNavigation tradeKey={tradeKey} />
      <div className="space-y-5 px-4 pt-2">
        <KpiStrip
          aria-label="Trade summary"
          items={[
            {
              id: "net",
              label: "Net P&L",
              value: <Pnl value={trade.netPnl} />,
              detail: (
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
              ),
            },
            {
              id: "gross",
              label: "Gross",
              value: <MonetaryValue>{fmtMoney(trade.grossPnl)}</MonetaryValue>,
            },
            {
              id: "fees",
              label: "Fees",
              value: <MonetaryValue>{fmtMoney(trade.fees)}</MonetaryValue>,
            },
            { id: "duration", label: "Duration", value: fmtDuration(trade.durationMs) },
            {
              id: "roi",
              label: "Net / entry notional",
              value: fmtPercent(netReturnOnEntry(trade), 2),
            },
          ]}
        />

        <KpiStrip
          aria-label="Trade prices and risk"
          items={[
            { id: "volume", label: "Volume", value: fmtNumber(trade.quantity, 4) },
            {
              id: "entry",
              label: "Avg entry",
              value: <MonetaryValue>{fmtNumber(trade.avgEntry)}</MonetaryValue>,
            },
            {
              id: "exit",
              label: "Avg exit",
              value: (
                <MonetaryValue>
                  {trade.avgExit === null ? "open" : fmtNumber(trade.avgExit)}
                </MonetaryValue>
              ),
            },
            {
              id: "planned",
              label: "Planned R",
              value: trade.plannedR === null ? "–" : `${fmtNumber(trade.plannedR)}R`,
            },
            {
              id: "realized",
              label: "Realized R",
              value: trade.realizedR === null ? "–" : `${fmtNumber(trade.realizedR)}R`,
            },
          ]}
        />
      </div>
      <div className="grid gap-6 px-4 pb-8 pt-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-5 xl:col-span-2">
          <Attachments type="trade" id={trade.key} variant="trade-gallery" />

          {runningPnl.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Running P&L</CardTitle>
                <p className="text-[13px] text-muted-foreground">Times in {timeZone}</p>
              </CardHeader>
              <CardContent>
                <EquityArea data={runningPnl} height={180} />
              </CardContent>
            </Card>
          )}

          {isManualAccount && <TradeOutcomeControls trade={trade} onClosed={refresh} />}

          <Card>
            <CardHeader>
              <CardTitle>Executions</CardTitle>
              <p className="text-[13px] text-muted-foreground">Times in {timeZone}</p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Fee</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {executions
                    .sort((a, b) => a.executedAt.localeCompare(b.executedAt))
                    .map((execution) => (
                      <TableRow key={execution.id}>
                        <TableCell className="text-muted-foreground">
                          {formatTimestamp(execution.executedAt, timeZone)}
                        </TableCell>
                        <TableCell>
                          <span className={execution.side === "buy" ? "text-profit" : "text-loss"}>
                            {execution.side === "buy" ? "▲ BUY" : "▼ SELL"}
                          </span>
                        </TableCell>
                        <TableCell className="tnum">{fmtNumber(execution.quantity, 4)}</TableCell>
                        <TableCell className="tnum">
                          <MonetaryValue>{fmtNumber(execution.price)}</MonetaryValue>
                        </TableCell>
                        <TableCell className="tnum text-muted-foreground">
                          <MonetaryValue>{fmtMoney(execution.fee)}</MonetaryValue>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <div className="flex justify-end">
            <DeleteTradeButton
              tradeKey={tradeKey}
              label={`this ${trade.symbol} ${trade.direction} trade`}
            />
          </div>
        </div>

        <div className="min-w-0 space-y-5">
          <AnnotationsCard key={trade.key} trade={trade} onPatch={patch} />
          <RuleChecklist tradeKey={trade.key} playbookId={trade.playbookId} />
          <TradeCritiqueSection tradeKey={trade.key} />
        </div>
      </div>
    </div>
  );
}

function AnnotationsCard({
  trade,
  onPatch,
}: {
  trade: TradeDetail;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [notes, setNotes] = useState(trade.notes ?? "");
  const noteEditor = useRef<RichEditorHandle>(null);
  const [tags, setTags] = useState((JSON.parse(trade.tagsJson ?? "[]") as string[]).join(", "));
  const [mistakes, setMistakes] = useState(
    (JSON.parse(trade.mistakesJson ?? "[]") as string[]).join(", "),
  );
  const [stopLoss, setStopLoss] = useState(trade.stopLoss?.toString() ?? "");
  const [profitTarget, setProfitTarget] = useState(trade.profitTarget?.toString() ?? "");

  // Determine hit state for visual indication:
  // If trade is closed with an exit and had both plans, grey out the unhit target
  const hitTarget = hitTradeTarget(trade.status, trade.avgExit, trade.stopLoss, trade.profitTarget);
  const isSlHit = hitTarget === "stop_loss";
  const isTpHit = hitTarget === "profit_target";
  const slGreyed = isTpHit;
  const tpGreyed = isSlHit;
  const { data: playbookData } = useApi<{ playbooks: { id: string; name: string }[] }>(
    "/api/playbooks",
  );
  const {
    save: debounced,
    status: saveStatus,
    flush,
  } = useAutosave(`/api/trades/${encodeURIComponent(trade.key)}`, "PATCH", () => void onPatch({}));

  const parseList = (value: string) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Journal this trade</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <TradeRating value={trade.rating} onChange={(rating) => onPatch({ rating })} />
          <label className="flex items-center gap-2 text-[15px]">
            <Checkbox
              checked={trade.reviewedAt !== null}
              onCheckedChange={(checked) => void onPatch({ reviewed: checked === true })}
            />
            Reviewed
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className={slGreyed ? "opacity-50 transition-opacity" : "transition-opacity"}>
            <label className="text-[13px] text-muted-foreground">
              Stop loss {isSlHit ? "(Hit)" : ""}
            </label>
            <MonetaryField>
              <Input
                value={stopLoss}
                onChange={(event) => {
                  setStopLoss(event.target.value);
                  debounced({
                    stopLoss: event.target.value === "" ? null : Number(event.target.value),
                  });
                }}
                placeholder="planned stop"
                inputMode="decimal"
              />
            </MonetaryField>
          </div>
          <div className={tpGreyed ? "opacity-50 transition-opacity" : "transition-opacity"}>
            <label className="text-[13px] text-muted-foreground">
              Profit target {isTpHit ? "(Hit)" : ""}
            </label>
            <MonetaryField>
              <Input
                value={profitTarget}
                onChange={(event) => {
                  setProfitTarget(event.target.value);
                  debounced({
                    profitTarget: event.target.value === "" ? null : Number(event.target.value),
                  });
                }}
                placeholder="planned target"
                inputMode="decimal"
              />
            </MonetaryField>
          </div>
        </div>

        <div>
          <label className="text-[13px] text-muted-foreground">Playbook</label>
          <Select
            value={trade.playbookId ?? "none"}
            onValueChange={(value) => void onPatch({ playbookId: value === "none" ? null : value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="No playbook" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No playbook</SelectItem>
              {playbookData?.playbooks.map((playbook) => (
                <SelectItem key={playbook.id} value={playbook.id}>
                  {playbook.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-[13px] text-muted-foreground">Tags (comma-separated)</label>
          <Input
            value={tags}
            onChange={(event) => {
              setTags(event.target.value);
              debounced({ tags: parseList(event.target.value) });
            }}
            placeholder="breakout, A+ setup"
          />
        </div>
        <div>
          <label className="text-[13px] text-muted-foreground">Mistakes</label>
          <Input
            value={mistakes}
            onChange={(event) => {
              setMistakes(event.target.value);
              debounced({ mistakes: parseList(event.target.value) });
            }}
            placeholder="chased entry, moved stop"
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[13px] text-muted-foreground">Notes</label>
          </div>
          <RichEditor
            editorRef={noteEditor}
            aiContext={`Trade note: ${trade.symbol} ${trade.direction}`}
            value={notes}
            onChange={(value) => {
              setNotes(value);
              debounced({ notes: value });
            }}
          />
          <div className="flex items-center justify-between text-[13px] text-muted-foreground">
            <span role="status">{saveStatus}</span>
            <Button variant="ghost" size="sm" onClick={() => void flush()}>
              Save now
            </Button>
          </div>
          <ReportExport source={{ kind: "trade", tradeKey: trade.key }} beforeExport={flush} />
        </div>
      </CardContent>
    </Card>
  );
}
