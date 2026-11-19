"use client";
import { useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { dayKeyOf, FILTER_KEYS, readFilters, type AnalysisFilters } from "@luxalgo/journal-core";
import { useApi } from "@/lib/use-api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FilterFields } from "./filter-fields";
import { SlidersHorizontal } from "lucide-react";
import { AccountSelector } from "./account-selector";
import { NAV_GROUPS } from "./nav-items";
import { PageHead } from "./ui/page-head";
import { cn } from "@/lib/utils";
export const useFilters = () => {
  const params = useSearchParams();
  const { data } = useApi<{ timeZone: string }>("/api/settings");
  const range = params.get("range") ?? "all",
    timeZone = data?.timeZone ?? "UTC";
  return useMemo(() => {
    const f = readFilters(new URLSearchParams(params.toString()));
    const today = dayKeyOf(new Date().toISOString(), timeZone);
    if (range === "ytd") {
      f.from = `${today.slice(0, 4)}-01-01`;
      f.to = today;
    } else if (["7d", "30d", "90d"].includes(range)) {
      const d = new Date(today + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() - Number(range.slice(0, -1)) + 1);
      f.from = d.toISOString().slice(0, 10);
      f.to = today;
    }
    return {
      accounts: f.accounts ?? null,
      from: f.from ?? null,
      to: f.to ?? null,
      range,
      timeZone,
      values: f,
      query: new URLSearchParams(Object.entries(f).filter(([, v]) => Boolean(v))).toString(),
    };
  }, [params, range, timeZone]);
};
export type Filters = ReturnType<typeof useFilters>;
/** Section label shown above the page title: the sidebar group the current route lives in. */
function sectionEyebrow(pathname: string) {
  for (const group of NAV_GROUPS)
    for (const item of group.items)
      if (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)) return group.label;
  return undefined;
}

/**
 * Page header and sticky capsule toolbar. `title` becomes the page's single h1 (rendered in a
 * PageHead that scrolls away); account, range, Filters and `actions` live in the capsule. Pages
 * without filter controls have nothing to float, so their `actions` sit in the PageHead instead
 * of an otherwise empty capsule.
 */
export function FilterBar({
  title,
  actions,
  eyebrow,
  lede,
  compact = false,
}: {
  title: string;
  actions?: React.ReactNode;
  /** Mono label above the title. Defaults to the sidebar group of the current page. */
  eyebrow?: React.ReactNode;
  lede?: React.ReactNode;
  /** Smaller head for full-height workspaces such as the notebook. */
  compact?: boolean;
}) {
  const router = useRouter(),
    pathname = usePathname(),
    params = useSearchParams();
  const filters = useFilters();
  const showFilters =
    ["/", "/reports", "/trades", "/calendar", "/journal", "/playbooks"].includes(pathname) ||
    pathname.startsWith("/journal/");
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<AnalysisFilters>({});
  const filterTitle = useRef<HTMLHeadingElement>(null);
  const count = Object.keys(filters.values).filter((k) => !["from", "to"].includes(k)).length;
  const apply = () => {
    const next = new URLSearchParams(params.toString());
    FILTER_KEYS.forEach((k) => next.delete(k));
    next.set("range", "custom");
    for (const [k, v] of Object.entries(draft)) if (v) next.set(k, v);
    router.replace(`${pathname}?${next}`);
    setOpen(false);
  };
  return (
    <>
      <PageHead
        data-compact={compact || undefined}
        className={cn("journal-page-head px-4", compact ? "pb-3 pt-5" : "pb-6 pt-8 sm:pt-10")}
        eyebrow={eyebrow ?? sectionEyebrow(pathname)}
        title={title}
        lede={compact ? undefined : lede}
        actions={showFilters ? undefined : actions}
      />
      {showFilters && (
        <div className="journal-toolbar pointer-events-none sticky z-10 px-4 pb-4">
          <div
            role="toolbar"
            aria-label="Page filters and actions"
            className="journal-filter-bar pointer-events-auto flex min-h-[52px] min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 rounded-[26px] border border-secondary bg-card px-2.5 py-1.5"
          >
            <AccountSelector />
            <div
              role="group"
              aria-label="Date range"
              className="flex max-w-full shrink-0 items-center gap-0.5"
            >
              {["7d", "30d", "90d", "ytd", "all"].map((range) => (
                <Button
                  key={range}
                  variant={filters.range === range ? "secondary" : "ghost"}
                  size="sm"
                  aria-pressed={filters.range === range}
                  className="h-8 px-3 text-[13px] text-muted-foreground aria-pressed:text-foreground"
                  onClick={() => {
                    const next = new URLSearchParams(params.toString());
                    next.set("range", range);
                    next.delete("from");
                    next.delete("to");
                    router.replace(`${pathname}?${next}`);
                  }}
                >
                  {range === "all" ? "All" : range.toUpperCase()}
                </Button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-[13px]"
              aria-label={`Filters${count > 0 ? `, ${count} active` : ""}`}
              title="Filter by dates, symbols, strategy, outcome, and more. All selected conditions must match."
              onClick={() => {
                setDraft(filters.values);
                setOpen(true);
              }}
            >
              <SlidersHorizontal className="size-3.5" strokeWidth={1.65} />
              <span className="max-sm:hidden">Filters</span>
              {count > 0 && <span className="text-muted-foreground">· {count}</span>}
            </Button>
            {actions && (
              <div className="journal-header-actions ml-auto flex min-w-0 max-w-full flex-wrap items-center gap-2">
                {actions}
              </div>
            )}
          </div>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="journal-filter-dialog sm:max-w-3xl"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            filterTitle.current?.focus();
          }}
        >
          <DialogHeader className="journal-filter-heading">
            <DialogTitle ref={filterTitle} tabIndex={-1} className="outline-none">
              Filter your journal
            </DialogTitle>
            <DialogDescription className="journal-filter-description">
              Times use {filters.timeZone}. Dates use the closing day, or opening day for open
              trades. All selected conditions must match.
            </DialogDescription>
          </DialogHeader>
          <div className="journal-filter-body">
            <FilterFields value={draft} onChange={setDraft} />
          </div>
          <div className="journal-filter-footer flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setDraft({})}
            >
              Clear filters
            </Button>
            <Button className="min-w-28" onClick={apply}>
              Apply filters
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
