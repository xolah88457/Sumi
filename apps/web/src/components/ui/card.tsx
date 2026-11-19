import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Flat 14px surface with a hairline border. `variant="flat"` drops the box for a
 * top hairline only, for strips and grouped rows that should not read as a card.
 */
function Card({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & { variant?: "default" | "flat" }) {
  return (
    <div
      data-variant={variant}
      className={cn(
        "min-w-0 text-card-foreground",
        variant === "flat"
          ? "border-t border-border bg-transparent"
          : "rounded-xl border border-border bg-card",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("min-w-0 flex flex-col space-y-1 p-5 pb-2", className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "min-w-0 break-words text-[13px] font-normal leading-snug text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("min-w-0 p-5 pt-2", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardContent };
