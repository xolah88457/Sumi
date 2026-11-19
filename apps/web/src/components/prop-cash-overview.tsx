"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { Card, CardContent } from "./ui/card";
import { EmptyState } from "./ui/empty-state";
import { KpiStrip } from "./ui/kpi-strip";
import { useVizTokens, tooltipStyle } from "./charts/tokens";
import { cashSummary, currencyDigits, propMoney } from "@/lib/prop-firms";

type Summary = ReturnType<typeof cashSummary>;
export function PropCashSummary({
  summary,
  currency,
  privacy,
}: {
  summary: Summary;
  currency: string;
  privacy: boolean;
}) {
  const money = (value: number) => (privacy ? "••••" : currency ? propMoney(value, currency) : "—");
  const netColor =
    privacy || !currency
      ? undefined
      : summary.net < 0
        ? "var(--loss)"
        : summary.net > 0
          ? "var(--profit)"
          : undefined;
  return (
    <KpiStrip
      aria-label="Cash summary"
      items={[
        {
          id: "spent",
          label: (
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="size-2 rounded-full bg-[var(--loss)]" />
              Money spent
            </span>
          ),
          value: money(summary.spent),
          detail: (
            <span className="block space-y-0.5">
              <span className="block">All fees, subscriptions and other costs</span>
              <span className="block">
                Refunded <span className="text-foreground">{money(summary.refunds)}</span> · Net
                cost <span className="text-foreground">{money(summary.netSpend)}</span>
              </span>
            </span>
          ),
        },
        {
          id: "received",
          label: (
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="size-2 rounded-full bg-[var(--brand)]" />
              Payouts received
            </span>
          ),
          value: money(summary.received),
          detail: (
            <span className="block space-y-0.5">
              <span className="block">Money received, after any reversals</span>
              <span className="block">Pending requests are tracked separately below.</span>
            </span>
          ),
        },
        {
          id: "net",
          label: "Net after costs",
          value: <span style={{ color: netColor }}>{money(summary.net)}</span>,
          detail: (
            <span className="block space-y-0.5">
              <span className="block">Payouts received + refunds − money spent</span>
              <span className="block">
                Return on net cost{" "}
                <span className="text-foreground">
                  {privacy
                    ? "••••"
                    : !currency || summary.roi === null
                      ? "—"
                      : `${(summary.roi * 100).toFixed(1)}%`}
                </span>
              </span>
            </span>
          ),
        },
      ]}
    />
  );
}
export function PropCashComparison({
  months,
  currency,
  privacy,
}: {
  months: (Summary & { month: string })[];
  currency: string;
  privacy: boolean;
}) {
  const t = useVizTokens();
  const divisor = currency ? 10 ** currencyDigits(currency) : 1;
  const rows = [...months]
    .reverse()
    .map((row) => ({ ...row, spent: row.spent / divisor, received: row.received / divisor }));
  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[21px] font-normal leading-snug tracking-[-0.02em]">
              Spending vs payouts
            </h3>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Monthly cash flow{currency ? ` · ${currency}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-4 text-[13px] text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-[var(--loss)]" />
              Money spent
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-[var(--brand)]" />
              Payouts received
            </span>
          </div>
        </div>
        {privacy || !currency || !rows.length ? (
          <EmptyState className="min-h-48 justify-center">
            {privacy
              ? "Chart hidden in privacy mode."
              : !currency
                ? "Choose a currency in Filters to compare spending and payouts."
                : "Record an expense or a payout receipt to start your comparison."}
          </EmptyState>
        ) : (
          <div className="h-64 min-w-0 sm:h-72">
            {t && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  accessibilityLayer
                  data={rows}
                  margin={{ top: 8, right: 0, left: 0, bottom: 0 }}
                  barGap={2}
                >
                  <CartesianGrid vertical={false} stroke={t.gridline} />
                  <XAxis
                    dataKey="month"
                    axisLine={false}
                    tickLine={false}
                    minTickGap={28}
                    tick={{ fill: t.inkMuted, fontSize: 12 }}
                    tickFormatter={(v) =>
                      new Intl.DateTimeFormat("en", {
                        month: "short",
                        year: "2-digit",
                        timeZone: "UTC",
                      }).format(new Date(`${v}-01T12:00:00Z`))
                    }
                  />
                  <YAxis
                    width={65}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: t.inkMuted, fontSize: 12 }}
                    tickFormatter={(v) =>
                      new Intl.NumberFormat("en", {
                        notation: "compact",
                        maximumFractionDigits: 1,
                      }).format(v)
                    }
                  />
                  <ReferenceLine y={0} stroke={t.baseline} />
                  <Tooltip
                    cursor={{ fill: t.gridline, opacity: 0.35 }}
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <div style={tooltipStyle(t)}>
                          <p className="mb-1 font-medium">{String(label)}</p>
                          {payload.map((item) => (
                            <p key={String(item.dataKey)}>
                              {item.name}:{" "}
                              {propMoney(Math.round(Number(item.value) * divisor), currency)}
                            </p>
                          ))}
                          <p>Refunds: {propMoney(payload[0]!.payload.refunds, currency)}</p>
                          <p className="mt-1 border-t pt-1">
                            Net after costs: {propMoney(payload[0]!.payload.net, currency)}
                          </p>
                        </div>
                      ) : null
                    }
                  />
                  <Bar
                    name="Money spent"
                    dataKey="spent"
                    fill={t.loss}
                    fillOpacity={0.72}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={24}
                    isAnimationActive={false}
                  />
                  <Bar
                    name="Payouts received"
                    dataKey="received"
                    fill={t.brand}
                    fillOpacity={0.72}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={24}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
        <p className="mt-4 text-[13px] text-muted-foreground">
          Refunds reduce your net cost. Hover a month for refunds and the final net amount.
        </p>
      </CardContent>
    </Card>
  );
}
