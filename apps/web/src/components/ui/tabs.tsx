"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex max-w-full items-center justify-start gap-1 overflow-x-auto text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-transparent px-4 text-sm font-medium transition-[background-color,border-color,color] duration-[120ms] hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-55 data-[state=active]:border-transparent data-[state=active]:bg-secondary data-[state=active]:text-foreground motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("mt-2 min-w-0 focus-visible:outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
