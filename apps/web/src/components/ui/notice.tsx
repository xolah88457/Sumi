import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Sand strip for notices (currency, AI, privacy, load problems). A quiet filled band instead of
 * a coloured alert box: optional icon, a 15px lead line, a 13px muted explanation, and an
 * optional action that sits to the right when there is room.
 */
function Notice({
  icon,
  title,
  children,
  action,
  tone = "default",
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  action?: React.ReactNode;
  /** `error` only tints the icon (red text on sand misses AA); the surface stays sand. */
  tone?: "default" | "error";
}) {
  return (
    <div
      data-slot="notice"
      data-tone={tone}
      className={cn(
        "flex min-w-0 flex-wrap items-start gap-x-3 gap-y-3 rounded-lg bg-secondary px-4 py-3",
        className,
      )}
      {...props}
    >
      {icon && (
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 shrink-0 [&_svg]:size-4",
            tone === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1 basis-60 space-y-1">
        {title && <p className="text-[15px] font-medium leading-snug">{title}</p>}
        {children && (
          <div className="text-[13px] leading-relaxed text-muted-foreground">{children}</div>
        )}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

export { Notice };
