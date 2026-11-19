import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-[15px] transition-[border-color,box-shadow] duration-[120ms] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
