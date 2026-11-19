"use client";

import type { ImportReview, ImportReviewOptions } from "@/lib/import-review";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { fmtMoney } from "@/lib/utils";

export function ImportReconciliation({
  review,
  options,
  onChange,
  onReview,
  busy,
}: {
  review?: ImportReview;
  options: ImportReviewOptions;
  onChange: (next: ImportReviewOptions) => void;
  onReview: () => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-3 border-t pt-3">
      <p className="text-[17px]">Review NinjaTrader import</p>
      <p className="text-[13px] text-muted-foreground">
        Keep each source account separate inside your selected journal account. Review the result
        before saving.
      </p>
      {review && (
        <>
          {review.sources.map((source) => (
            <label key={source.key} className="block space-y-1 text-[15px]">
              <span>{source.label}</span>
              <select
                aria-label={`Source mapping for ${source.label}`}
                disabled={busy || source.saved}
                className="block h-10 w-full rounded-md border border-input bg-card px-3 text-[15px] focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                value={options.sourceMappings?.[source.key] ?? source.selected ?? ""}
                onChange={(event) =>
                  onChange({
                    ...options,
                    sourceMappings: { ...options.sourceMappings, [source.key]: event.target.value },
                  })
                }
              >
                <option value="">Choose the source this file belongs to</option>
                {review.savedSources.map((saved) => (
                  <option key={saved.id} value={saved.id}>
                    {saved.name}
                  </option>
                ))}
                <option value="new">Create a separate source account</option>
              </select>
            </label>
          ))}
          <p className="text-[13px] text-muted-foreground">
            If an account or connection was renamed, select its existing source. Choose a new source
            only for a genuinely different account.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[15px]" role="status">
            <span>{review.inserted} new fills</span>
            <span>{review.duplicates} duplicate fills</span>
            <span>{review.corrections.length} fee corrections</span>
          </div>
          {review.multipliers.map((item) => (
            <p key={item.symbol} className="text-[13px]">
              {item.symbol} multiplier: {item.value ?? "missing — configure in Settings"}
            </p>
          ))}
          {review.multipliers.some((item) => item.value === null) && (
            <a className="text-[15px] underline" href="/settings" target="_blank" rel="noreferrer">
              Open Settings, then review again
            </a>
          )}
          {review.totals && (
            <div className="rounded-lg bg-secondary px-4 py-3 text-[15px]">
              <p>Destination account after import ({review.currency})</p>
              <p>
                {review.totals.closedTrades} closed trades · {review.totals.openTrades} open trades
              </p>
              <p>
                Closed-trade net P&amp;L: {fmtMoney(review.totals.netPnl, review.currency)} · Fees:{" "}
                {fmtMoney(review.totals.fees, review.currency)}
              </p>
            </div>
          )}
          {review.needsCompleteHistory && (
            <label className="flex items-start gap-2 text-[15px]">
              <input
                type="checkbox"
                checked={!!options.completeHistory}
                disabled={busy}
                onChange={(event) =>
                  onChange({ ...options, completeHistory: event.target.checked })
                }
              />
              <span>
                This export includes every execution for each listed source contract between its
                first and last timestamp. It is not a partial selection of repeated fills.
              </span>
            </label>
          )}
          {!!review.corrections.length && (
            <div className="space-y-2">
              {review.corrections.slice(0, 10).map((correction, index) => (
                <p key={index} className="text-[13px]">
                  {correction.symbol} · {correction.executedAt}: commission{" "}
                  {fmtMoney(correction.oldFee, review.currency)} →{" "}
                  {fmtMoney(correction.newFee, review.currency)}
                </p>
              ))}
              {review.corrections.length > 10 && (
                <p className="text-[13px]">
                  Plus {review.corrections.length - 10} more fee corrections.
                </p>
              )}
              <label className="flex items-start gap-2 text-[15px]">
                <input
                  type="checkbox"
                  checked={!!options.approveFeeCorrections}
                  disabled={busy}
                  onChange={(event) =>
                    onChange({ ...options, approveFeeCorrections: event.target.checked })
                  }
                />
                <span>
                  Apply these commission corrections to the existing executions and recalculate
                  P&amp;L.
                </span>
              </label>
            </div>
          )}
          {review.warnings.map((message) => (
            <Notice key={message} icon={<TriangleAlert />}>
              {message}
            </Notice>
          ))}
          {review.conflicts.map((message) => (
            <Notice key={message} role="alert" tone="error" title={message} />
          ))}
        </>
      )}
      <Button variant="outline" disabled={busy} onClick={onReview}>
        {busy ? "Reviewing…" : "Review import"}
      </Button>
      {review?.token && (
        <p className="text-[13px] text-muted-foreground">
          Review complete. Import will save this result; if the file, settings or journal changes,
          another review is required.
        </p>
      )}
    </div>
  );
}
