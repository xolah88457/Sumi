"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { HoverHint } from "./tooltip";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-[background-color,border-color,color,filter] duration-[120ms] ease-[var(--ease)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-55 motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:brightness-[0.94]",
        destructive: "bg-destructive text-destructive-foreground hover:brightness-[0.94]",
        outline: "border border-input bg-transparent hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:brightness-[0.96]",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5 py-2 pointer-coarse:h-11",
        sm: "h-8 px-4 text-[13px] pointer-coarse:h-9",
        lg: "h-11 px-8 text-[15px]",
        icon: "h-10 w-10 pointer-coarse:h-11 pointer-coarse:w-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  title,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  const hint = title || (size === "icon" ? props["aria-label"] : undefined);
  const button = (
    <Comp
      aria-label={props["aria-label"] ?? (size === "icon" ? title : undefined)}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
  return hint ? <HoverHint content={hint}>{button}</HoverHint> : button;
}

export { Button, buttonVariants };
