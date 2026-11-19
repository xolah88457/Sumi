"use client";

import Link from "next/link";
import { useId } from "react";
import { ArrowUpRight, CircleAlert, Sparkles, X } from "lucide-react";
import { aiFeedback } from "@/lib/ai-feedback";
import { Button } from "./ui/button";
import { Notice } from "./ui/notice";

export function AiNotice({
  error,
  onRetry,
  onDismiss,
}: {
  error: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const feedback = aiFeedback(error);
  const id = useId();
  const Icon = feedback.tone === "error" ? CircleAlert : Sparkles;
  return (
    <Notice
      data-ai-notice
      role={feedback.tone === "error" ? "alert" : "status"}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      tone={feedback.tone === "error" ? "error" : "default"}
      icon={<Icon />}
      className="flex-nowrap"
      action={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mr-2 -mt-1.5 h-8 w-8 shrink-0 pointer-coarse:h-9 pointer-coarse:w-9 text-muted-foreground"
          aria-label="Dismiss AI notice"
          onClick={onDismiss}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      }
    >
      <p id={`${id}-title`} className="text-[15px] font-medium leading-snug text-foreground">
        {feedback.title}
      </p>
      <p id={`${id}-description`} className="mt-1 max-w-2xl text-[13px] leading-relaxed">
        {feedback.description}
      </p>
      {feedback.action ? (
        <Link
          href={feedback.action.href}
          className="mt-3 inline-flex items-center gap-1 rounded text-[13px] font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-current"
        >
          {feedback.action.label}
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      ) : feedback.retry ? (
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </Notice>
  );
}
