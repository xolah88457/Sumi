import * as React from "react";
import { cn } from "@/lib/utils";
import { SignedText } from "./signed-text";

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
  rowRules = false,
  className,
  ...props
}: Omit<React.ComponentProps<"dl">, "children"> & {
  items: KpiItem[];
  /**
   * For long strips that wrap onto several rows: draw a hairline above every cell instead of
   * vertical dividers, so each wrapped row is ruled off. Off by default.
   */
  rowRules?: boolean;
}) {
  return (
    <dl
      data-slot="kpi-strip"
      className={cn(
        "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(150px,1fr))] border-border",
        rowRules ? "border-b" : "border-y",
        className,
      )}
      {...props}
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={cn(
            "flex min-w-0 flex-col gap-1 border-border px-5 py-5 max-[640px]:px-4",
            rowRules ? "border-t" : "not-first:border-l",
          )}
        >
          <dd className="tnum order-1 min-w-0 truncate text-[clamp(20px,1.1vw+15px,32px)] leading-tight">
            {typeof item.value === "string" ? <SignedText>{item.value}</SignedText> : item.value}
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
