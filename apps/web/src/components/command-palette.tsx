"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Eye,
  EyeOff,
  Monitor,
  Moon,
  PanelLeft,
  Plus,
  Search,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AddTradeDialog } from "./add-trade-dialog";
import { NAV_GROUPS } from "./nav-items";
import { usePrivacyControls } from "./privacy";
import { useThemePreference } from "./theme";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

export interface Command {
  id: string;
  label: string;
  group: "Go to" | "Actions" | "Appearance";
  icon: LucideIcon;
  /** Extra words the query can match without showing them. */
  keywords?: string;
  /** Right-aligned hint, such as a shortcut or the current state. */
  hint?: string;
  run: () => void;
}

const isWordStart = (text: string, token: string) =>
  text.split(/[\s/·-]+/).some((word) => word.startsWith(token));

/** "dj" matches "Daily journal": the token spells the initials of the label's words. */
const isAcronym = (text: string, token: string) =>
  token.length > 1 &&
  text
    .split(/[\s/·-]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .startsWith(token);

/** Higher is better; -1 means the command does not match every word of the query. */
export function scoreCommand(query: string, command: Pick<Command, "label" | "keywords">) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  const label = command.label.toLowerCase();
  const keywords = (command.keywords ?? "").toLowerCase();
  let total = 0;
  for (const token of tokens) {
    const best = label.startsWith(token)
      ? 100
      : isWordStart(label, token)
        ? 80
        : label.includes(token)
          ? 60
          : isWordStart(keywords, token) || keywords.includes(token)
            ? 40
            : isAcronym(label, token)
              ? 20
              : -1;
    if (best < 0) return -1;
    total += best;
  }
  return total;
}

/** Filter and rank; equal scores keep their original order. */
export function filterCommands<T extends Pick<Command, "label" | "keywords">>(
  commands: readonly T[],
  query: string,
): T[] {
  if (!query.trim()) return [...commands];
  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(query, command) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command);
}

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** "⌘K" on Apple platforms, "Ctrl K" elsewhere. Starts as Ctrl K so server and client markup match. */
export function ShortcutHint({ className }: { className?: string }) {
  const [label, setLabel] = useState("Ctrl K");
  useEffect(() => {
    if (isMac()) setLabel("⌘K");
  }, []);
  return (
    <kbd
      className={cn(
        "rounded-md border bg-card px-1.5 py-0.5 font-mono text-[11px] leading-none text-muted-foreground",
        className,
      )}
    >
      {label}
    </kbd>
  );
}

export function CommandPalette({
  open,
  onOpenChange,
  onToggleSidebar,
  filterQuery = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleSidebar: () => void;
  /** Active filter query string, carried over to the pages that read it. */
  filterQuery?: string;
}) {
  const router = useRouter();
  const { preference, setPreference } = useThemePreference();
  const privacy = usePrivacyControls();
  const inputId = useId();
  const [addOpen, setAddOpen] = useState(false);
  const skipFocusRestore = useRef(false);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "k" || event.defaultPrevented) return;
      // Leave other dialogs (filters, add trade, the mobile drawer) alone.
      if (!open && document.querySelector("[role='dialog'][data-state='open']")) return;
      event.preventDefault();
      onOpenChange(!open);
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [open, onOpenChange]);

  const commands = useMemo<Command[]>(() => {
    const pages = NAV_GROUPS.flatMap((group) => group.items).map(
      ({ href, label, icon }): Command => ({
        id: `go:${href}`,
        label,
        group: "Go to",
        icon,
        keywords: "page open navigate",
        run: () =>
          router.push(href === "/prop-firms" || !filterQuery ? href : `${href}?${filterQuery}`),
      }),
    );
    const themes: [typeof preference, string, LucideIcon][] = [
      ["light", "Light", Sun],
      ["dark", "Dark", Moon],
      ["system", "System", Monitor],
    ];
    return [
      {
        id: "add-trade",
        label: "Add trade",
        group: "Actions",
        icon: Plus,
        keywords: "new manual entry record log",
        run: () => {
          skipFocusRestore.current = true;
          setAddOpen(true);
        },
      },
      ...pages,
      ...themes.map(([value, name, icon]): Command => ({
        id: `theme:${value}`,
        label: `Appearance: ${name}`,
        group: "Appearance",
        icon,
        keywords: "theme color mode",
        hint: preference === value ? "Current" : undefined,
        run: () => setPreference(value),
      })),
      {
        id: "privacy",
        label: privacy.enabled ? "Show amounts (privacy off)" : "Hide amounts (privacy on)",
        group: "Actions",
        icon: privacy.enabled ? Eye : EyeOff,
        keywords: "privacy mode toggle balances pnl hide show",
        run: privacy.toggle,
      },
      {
        id: "sidebar",
        label: "Collapse or expand sidebar",
        group: "Actions",
        icon: PanelLeft,
        keywords: "toggle sidebar navigation",
        hint: "⌘B",
        run: onToggleSidebar,
      },
    ];
  }, [router, filterQuery, preference, setPreference, privacy, onToggleSidebar]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="journal-palette top-[14%] max-w-xl -translate-y-0 gap-0 overflow-hidden p-0 sm:p-0"
          // Radix only restores focus to a Dialog.Trigger, and this dialog has none (it opens from
          // a shortcut), so remember the opener here and put focus back ourselves on close.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            opener.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            document.getElementById(inputId)?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (skipFocusRestore.current) skipFocusRestore.current = false;
            else if (opener.current?.isConnected) opener.current.focus();
            opener.current = null;
          }}
        >
          <DialogTitle className="sr-only">Command palette</DialogTitle>
          <DialogDescription className="sr-only">
            Type to filter, use the arrow keys to choose, Enter to run, Escape to close.
          </DialogDescription>
          <PaletteBody
            inputId={inputId}
            commands={commands}
            onRun={(command) => {
              onOpenChange(false);
              command.run();
            }}
          />
        </DialogContent>
      </Dialog>
      <AddTradeDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSaved={(tradeKey) =>
          router.push(tradeKey ? `/trades/${encodeURIComponent(tradeKey)}` : "/trades")
        }
      />
    </>
  );
}

function PaletteBody({
  inputId,
  commands,
  onRun,
}: {
  inputId: string;
  commands: Command[];
  onRun: (command: Command) => void;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const results = useMemo(() => filterCommands(commands, query), [commands, query]);
  const current = Math.min(active, results.length - 1);
  const optionId = (index: number) => `${id}-option-${index}`;

  useEffect(() => {
    list.current?.querySelector(`[id="${optionId(current)}"]`)?.scrollIntoView?.({
      block: "nearest",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const move = (delta: number) =>
    setActive(results.length ? (current + delta + results.length) % results.length : 0);

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center gap-3 border-b px-4">
        <Search className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.65} aria-hidden />
        <input
          id={inputId}
          role="combobox"
          aria-label="Search commands"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results.length ? optionId(current) : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search pages and actions"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown") move(1);
            else if (event.key === "ArrowUp") move(-1);
            else if (event.key === "Home") setActive(0);
            else if (event.key === "End") setActive(results.length - 1);
            else if (event.key === "Enter") {
              const command = results[current];
              if (command) onRun(command);
            } else return;
            event.preventDefault();
          }}
          className="h-14 min-w-0 flex-1 bg-transparent pr-8 text-base outline-none placeholder:text-muted-foreground"
        />
      </div>
      <ul
        ref={list}
        id={listId}
        role="listbox"
        aria-label="Commands"
        className="max-h-[min(22rem,calc(100dvh-14rem))] overflow-y-auto overscroll-contain p-2"
      >
        {results.map((command, index) => {
          const Icon = command.icon;
          const selected = index === current;
          return (
            <li
              key={command.id}
              id={optionId(index)}
              role="option"
              aria-selected={selected}
              onMouseMove={() => selected || setActive(index)}
              onClick={() => onRun(command)}
              className={cn(
                "flex h-10 cursor-pointer items-center gap-3 rounded-full px-3.5 text-[15px]",
                selected ? "bg-accent text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon
                className={cn("size-4 shrink-0", selected && "text-brand")}
                strokeWidth={1.65}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{command.label}</span>
              {command.hint ? (
                <span className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.06em]">
                  {command.hint === "Current" && <Check className="size-3.5" aria-hidden />}
                  {command.hint}
                </span>
              ) : (
                <span className="font-mono text-[11px] uppercase tracking-[0.06em] opacity-70">
                  {command.group}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {!results.length && (
        <p role="status" className="px-3.5 py-8 text-center text-sm text-muted-foreground">
          No matching commands
        </p>
      )}
    </div>
  );
}
