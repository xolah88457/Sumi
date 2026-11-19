import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[13px] font-medium leading-5 transition-colors",
  {
    variants: {
      variant: {
        default: "border-primary bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border bg-card text-foreground",
        /**
         * Win/loss chips: text carries the state, the border style repeats it
         * (solid for win, dashed for loss) and color only reinforces.
         */
        profit: "border-solid border-profit/60 bg-profit/10 text-profit",
        loss: "border-dashed border-loss/70 bg-loss/10 text-loss",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
