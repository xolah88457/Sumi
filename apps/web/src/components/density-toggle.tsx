"use client";

import { Button } from "@/components/ui/button";
import type { TableDensity } from "@/lib/table-density";
import { cn } from "@/lib/utils";

const OPTIONS: { value: TableDensity; label: string }[] = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
];

/** Small segmented control for table row density. */
export function DensityToggle({
  value,
  onChange,
  className,
}: {
  value: TableDensity;
  onChange: (value: TableDensity) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Table density"
      className={cn(
        "journal-density-toggle inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border p-0.5",
        className,
      )}
    >
      {OPTIONS.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={value === option.value ? "secondary" : "ghost"}
          aria-pressed={value === option.value}
          className="h-7 px-3 text-[13px] text-muted-foreground aria-pressed:text-foreground"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
