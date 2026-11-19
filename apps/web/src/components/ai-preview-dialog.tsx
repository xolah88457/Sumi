"use client";

import { Sparkles, ShieldCheck, Server, Cloud, Info } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import type { AiContextPreview } from "@/server/ai-prompt";

interface AiPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  preview: AiContextPreview | null;
  loading: boolean;
  error?: string | null;
  sending?: boolean;
  onConfirm: (fingerprint?: string) => void | Promise<void>;
  onCancel?: () => void;
  onRefresh?: () => void;
  confirmLabel?: string;
  /** Heading for the data section; defaults to the journal data wording. */
  contextLabel?: string;
}

export function AiPreviewDialog({
  open,
  onOpenChange,
  title = "Review AI Request",
  preview,
  loading,
  error,
  sending = false,
  onConfirm,
  onCancel,
  onRefresh,
  confirmLabel,
  contextLabel = "Journal data context (grounding data)",
}: AiPreviewDialogProps) {
  const close = () => {
    onCancel?.();
    onOpenChange(false);
  };

  const isLocal = preview?.isLocal ?? false;
  const sendButtonText = confirmLabel ?? (preview ? `Send to ${preview.providerName}` : "Send");
  const isDriftError = Boolean(
    error && (error.includes("changed since preview") || error.includes("updated preview")),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles aria-hidden="true" className="size-5 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription>
            Preview snapshot of your journal data and settings. Context is verified and rebuilt live
            upon sending.
          </DialogDescription>
        </DialogHeader>

        {preview && (
          <div className="space-y-2 rounded-lg bg-secondary px-4 py-3 text-[13px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[15px] text-foreground">
                {isLocal ? (
                  <Server className="h-3.5 w-3.5 text-profit" />
                ) : (
                  <Cloud className="h-3.5 w-3.5 text-primary" />
                )}
                <span>Provider: {preview.providerName}</span>
              </div>
              <span className="rounded-sm border bg-card px-2 py-0.5 font-mono text-[13px] text-foreground">
                Model: {preview.model || "default"}
              </span>
            </div>
            <p className="flex items-start gap-1.5 leading-relaxed text-muted-foreground">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>{preview.networkPrivacy}</span>
            </p>
            <p className="flex items-start gap-1.5 border-t border-border pt-2 text-muted-foreground">
              <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Snapshot at review time (id: {preview.snapshotFingerprint}). Exact prompt is rebuilt
                on send; sending halts if data or instructions change.
              </span>
            </p>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-[15px] text-muted-foreground">
            <Sparkles
              aria-hidden="true"
              className="size-6 animate-spin text-primary motion-reduce:animate-none"
            />
            <span>Generating context preview snapshot…</span>
          </div>
        ) : error ? (
          <div role="alert" className="space-y-2 rounded-lg bg-secondary px-4 py-3 text-[15px]">
            <p>{error}</p>
            {isDriftError && onRefresh && (
              <Button type="button" size="sm" variant="outline" onClick={onRefresh}>
                Refresh preview snapshot
              </Button>
            )}
          </div>
        ) : preview ? (
          <div className="flex-1 space-y-4 overflow-y-auto pr-1 text-[13px]">
            {preview.customInstructions ? (
              <div>
                <div className="mb-1.5 text-[15px] text-foreground">
                  Personal trading instructions
                </div>
                <pre className="whitespace-pre-wrap rounded-lg border bg-secondary p-3 font-mono text-[13px] leading-relaxed">
                  {preview.customInstructions}
                </pre>
              </div>
            ) : null}

            <div>
              <div className="mb-1.5 text-[15px] text-foreground">Task prompt</div>
              <pre className="whitespace-pre-wrap rounded-lg border bg-secondary p-3 font-mono text-[13px] leading-relaxed">
                {preview.taskPrompt}
              </pre>
            </div>

            <div>
              <div className="mb-1.5 text-[15px] text-foreground">{contextLabel}</div>
              <pre className="whitespace-pre-wrap rounded-lg border bg-secondary p-3 font-mono text-[13px] leading-relaxed max-h-56 overflow-y-auto">
                {preview.journalContext}
              </pre>
            </div>

            <div>
              <div className="mb-1.5 text-[15px] text-foreground">
                System instructions & boundaries
              </div>
              <pre className="whitespace-pre-wrap rounded-lg border bg-secondary p-3 font-mono text-[13px] leading-relaxed max-h-36 overflow-y-auto">
                {preview.effectiveSystemPrompt}
              </pre>
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" size="sm" disabled={sending} onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={loading || Boolean(error) || sending || !preview}
            onClick={() => void onConfirm(preview?.snapshotFingerprint)}
          >
            <Sparkles className="h-4 w-4" />
            {sending ? "Sending…" : sendButtonText}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
