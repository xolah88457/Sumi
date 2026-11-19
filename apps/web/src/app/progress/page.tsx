"use client";
import { DatePicker } from "@/components/ui/date-picker";
import { OptionSelect } from "@/components/ui/option-select";
import { Checkbox } from "@/components/ui/checkbox";

import { HoverHint } from "@/components/ui/tooltip";
import { Suspense, useState } from "react";
import { FilterBar } from "@/components/filter-bar";
import { Field, fieldClass } from "@/components/filter-fields";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { Notice } from "@/components/ui/notice";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReviewExport } from "@/components/review-export";
import { useApi, postJson } from "@/lib/use-api";
import { scheduledRules, progressScore, type Routine, type RoutineCheck } from "@/lib/progress";
const STAGES = ["Before trading", "During trading", "After trading"];
export default function ProgressPage() {
  return (
    <Suspense>
      <Progress />
    </Suspense>
  );
}
function Progress() {
  const { data, error, refresh } = useApi<{
    rules: Routine[];
    checks: RoutineCheck[];
    today: string;
  }>("/api/workspace/progress");
  const [date, setDate] = useState(""),
    [open, setOpen] = useState(false),
    [title, setTitle] = useState(""),
    [stage, setStage] = useState(STAGES[0]!),
    [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5]),
    [failure, setFailure] = useState(""),
    [busy, setBusy] = useState(false);
  const selected = date || data?.today || "",
    rules = data ? scheduledRules(data.rules, selected) : [],
    score = data ? progressScore(data.rules, data.checks, selected) : null;
  const days = data
    ? Array.from({ length: 91 }, (_, i) => {
        const d = new Date(`${data.today}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 90 + i);
        const key = d.toISOString().slice(0, 10);
        return { date: key, ...progressScore(data.rules, data.checks, key) };
      })
    : [];
  async function act(body: unknown, method: "POST" | "DELETE" = "POST") {
    setBusy(true);
    try {
      await postJson("/api/workspace/progress", body, method);
      setFailure("");
      refresh();
      return true;
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Could not save.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <FilterBar
        title="Progress"
        lede="Build a repeatable trading day. Routines are tracked apart from trade filters and profit."
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            Add routine
          </Button>
        }
      />
      <div className="space-y-5 px-4 pb-8">
        {(error || failure) && <Notice role="alert" tone="error" title={error || failure} />}
        <KpiStrip
          aria-label="Daily completion"
          items={[
            {
              id: "completion",
              label: "Daily completion",
              value: score?.score == null ? "–" : `${Math.round(score.score * 100)}%`,
              detail: "Share of scheduled routines done",
            },
            {
              id: "done",
              label: "Routines completed",
              value: `${score?.completed ?? 0} / ${score?.total ?? 0}`,
              detail: selected && selected === data?.today ? "Today" : selected,
            },
          ]}
        />
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="w-full max-w-60">
            <Field label="Review date">
              <DatePicker
                label="Progress date"
                value={selected}
                max={data?.today}
                onValueChange={setDate}
              />
            </Field>
          </div>
          <ReviewExport
            document={{
              title: `Routine review · ${selected}`,
              lines: [
                `Completed: ${score?.completed ?? 0}/${score?.total ?? 0}`,
                ...rules.map(
                  (r) =>
                    `${data?.checks.some((c) => c.date === selected && c.ruleId === r.id && c.done) ? "[done]" : "[ ]"} ${r.stage}: ${r.title}`,
                ),
              ],
            }}
          />
        </div>
        {data && data.rules.length === 0 && (
          <EmptyState
            title="No routines yet"
            action={<Button onClick={() => setOpen(true)}>Add routine</Button>}
          >
            Add the steps you want to repeat before, during and after trading.
          </EmptyState>
        )}
        <div className="grid gap-5 xl:grid-cols-3">
          {STAGES.map((s) => (
            <Card key={s}>
              <CardHeader>
                <CardTitle>{s}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {rules
                  .filter((r) => r.stage === s)
                  .map((r) => (
                    <div
                      key={r.id}
                      className="flex items-start justify-between gap-2 border-t pt-3 first:border-t-0 first:pt-0"
                    >
                      <label className="flex items-start gap-3 text-[15px]">
                        <Checkbox
                          className="mt-1"
                          checked={
                            data?.checks.some(
                              (c) => c.ruleId === r.id && c.date === selected && c.done,
                            ) ?? false
                          }
                          disabled={busy || selected > (data?.today ?? "")}
                          onCheckedChange={(checked) =>
                            void act({ ruleId: r.id, date: selected, done: checked === true })
                          }
                        />
                        {r.title}
                      </label>
                      {!r.archivedAt && (
                        <button
                          className="text-[13px] text-muted-foreground underline"
                          onClick={() => {
                            if (confirm(`Archive “${r.title}”? Previous days are preserved.`))
                              void act({ id: r.id }, "DELETE");
                          }}
                        >
                          Archive
                        </button>
                      )}
                    </div>
                  ))}
                {!rules.some((r) => r.stage === s) && (
                  <p className="text-[13px] text-muted-foreground">No routines scheduled.</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Last 13 weeks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-flow-col grid-rows-7 gap-1 overflow-x-auto">
              {days.map((d) => (
                <HoverHint
                  key={d.date}
                  heading={d.date}
                  content={`${d.completed} of ${d.total} routines completed`}
                >
                  <button
                    key={d.date}
                    aria-label={`${d.date}: ${d.completed}/${d.total} complete`}
                    onClick={() => setDate(d.date)}
                    className={`min-h-7 min-w-7 rounded-md border ${selected === d.date ? "border-foreground" : "border-transparent"}`}
                    style={{
                      background:
                        d.score === null
                          ? "var(--muted)"
                          : `color-mix(in srgb, var(--brand) ${15 + d.score * 75}%, var(--card))`,
                    }}
                  />
                </HoverHint>
              ))}
            </div>
            <p className="mt-3 text-[13px] text-muted-foreground">
              Brighter squares mean a higher completion rate. Grey means no scheduled routines.
              Click a day to review it. New routines start today.
            </p>
          </CardContent>
        </Card>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add a daily routine</DialogTitle>
            </DialogHeader>
            <Field label="Routine">
              <input
                className={fieldClass}
                value={title}
                placeholder="Review the economic calendar"
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="When">
              <OptionSelect
                className={fieldClass}
                value={stage}
                onValueChange={(next) => setStage(next)}
              >
                {STAGES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </OptionSelect>
            </Field>
            <div className="flex flex-wrap gap-3">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => (
                <label key={day} className="flex items-center gap-1 text-[13px]">
                  <Checkbox
                    checked={weekdays.includes(i)}
                    onCheckedChange={(checked) =>
                      setWeekdays(
                        checked === true ? [...weekdays, i] : weekdays.filter((n) => n !== i),
                      )
                    }
                  />
                  {day}
                </label>
              ))}
            </div>
            {failure && (
              <p role="alert" className="text-[13px] text-destructive">
                {failure}
              </p>
            )}
            <Button
              disabled={!title.trim() || !weekdays.length || busy}
              onClick={async () => {
                if (await act({ title, stage, weekdays })) {
                  setOpen(false);
                  setTitle("");
                }
              }}
            >
              Add routine
            </Button>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
