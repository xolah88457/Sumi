import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Page identity: sentence-case eyebrow (13px, 0.08em), display serif title, muted lede, and a slot for
 * page-level actions. It is the page's h1 and scrolls away with the content.
 */
function PageHead({
  eyebrow,
  title,
  lede,
  actions,
  className,
  ...props
}: Omit<React.ComponentProps<"header">, "title"> & {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header
      data-slot="page-head"
      className={cn("flex min-w-0 flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}
      {...props}
    >
      <div className="min-w-0 max-w-[64ch]">
        {eyebrow && (
          <p className="mb-3 text-[13px] leading-none tracking-[0.08em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 className="text-balance text-[clamp(34px,2.2vw+18px,48px)] font-normal leading-[1.04] tracking-[-0.04em]">
          {title}
        </h1>
        {lede && <p className="mt-3 text-lg leading-snug text-muted-foreground">{lede}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export { PageHead };
