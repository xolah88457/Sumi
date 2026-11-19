import { Button } from "./ui/button";
import { Notice } from "./ui/notice";

/** A failed-load message with a retry button. `panel` is the bordered card used by report widgets. */
export function LoadError({
  message,
  onRetry,
  variant = "inline",
}: {
  message: string;
  onRetry: () => void;
  variant?: "inline" | "panel";
}) {
  if (variant === "panel")
    return (
      <div role="alert" className="rounded-xl border p-5">
        <p className="text-[15px] text-destructive">{message}</p>
        <Button onClick={onRetry} variant="outline" size="sm" className="mt-3">
          Try again
        </Button>
      </div>
    );
  return (
    <Notice
      role="alert"
      tone="error"
      title={message}
      action={
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  );
}
