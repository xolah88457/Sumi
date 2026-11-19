import * as React from "react";
import { cn } from "@/lib/utils";

/** Dashed, quiet placeholder with muted copy and at most one pill action. */
function EmptyState({
  title,
  children,
  action,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  title?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex min-w-0 flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-8 text-center",
        className,
      )}
      {...props}
    >
      {title && <p className="text-[21px] font-normal leading-snug tracking-[-0.02em]">{title}</p>}
      {children && <div className="max-w-[56ch] text-[15px] text-muted-foreground">{children}</div>}
      {action && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div>
      )}
    </div>
  );
}

export { EmptyState };
