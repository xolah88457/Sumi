import * as React from "react";
import { cn } from "@/lib/utils";

export interface KpiItem {
  /** Stable key; also used as the React key. */
  id: string;
  label: React.ReactNode;
  /** Pre-formatted value. Signed P&L must keep its sign in the text, never colour alone. */
  value: React.ReactNode;
  /** Optional small line under the value, such as a delta chip or a caption. */
  detail?: React.ReactNode;
}

/**
 * Hairline-ruled metric strip: big regular-weight serif figures with a 13px muted
 * label below, no boxes. Wraps to as many columns as fit.
 */
function KpiStrip({
  items,
  className,
  ...props
}: Omit<React.ComponentProps<"dl">, "children"> & { items: KpiItem[] }) {
  return (
    <dl
      data-slot="kpi-strip"
      className={cn(
        "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(150px,1fr))] border-y border-border",
        className,
      )}
      {...props}
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="flex min-w-0 flex-col gap-1 border-border px-5 py-5 not-first:border-l max-[640px]:px-4"
        >
          <dd className="tnum order-1 min-w-0 truncate text-[clamp(20px,1.1vw+15px,32px)] leading-tight">
            {item.value}
          </dd>
          <dt className="order-2 text-[13px] leading-snug text-muted-foreground">{item.label}</dt>
          {item.detail && (
            <dd className="order-3 text-[13px] text-muted-foreground">{item.detail}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}

export { KpiStrip };
