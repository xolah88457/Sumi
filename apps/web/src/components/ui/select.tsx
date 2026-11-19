"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-10 w-full min-w-0 items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-card px-3.5 py-2 text-[15px] text-foreground transition-[border-color,box-shadow,background-color] duration-[120ms] hover:border-muted-foreground/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:border-ring data-[state=open]:border-ring disabled:cursor-not-allowed disabled:opacity-55 [&>span]:truncate motion-reduce:transition-none",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  sideOffset = 6,
  collisionPadding = 12,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className={cn(
          "journal-popup journal-menu-surface relative z-50 max-h-[min(24rem,var(--radix-select-content-available-height))] min-w-[8rem] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border bg-popover text-popover-foreground",
          position === "popper" && "min-w-[var(--radix-select-trigger-width)]",
          className,
        )}
        position={position}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center bg-popover text-muted-foreground">
          <ChevronUp className="size-3.5" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="p-1.5">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center bg-popover text-muted-foreground">
          <ChevronDown className="size-3.5" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex min-h-9 w-full cursor-default select-none items-center rounded-md py-1.5 pl-2.5 pr-8 text-[15px] outline-none focus:bg-accent focus:text-accent-foreground data-[state=checked]:font-medium data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>span:last-child]:break-words",
        className,
      )}
      {...props}
    >
      <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem };
