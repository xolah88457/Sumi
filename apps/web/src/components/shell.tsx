"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { FILTER_KEYS } from "@luxalgo/journal-core";
import { usePathname, useSearchParams } from "next/navigation";
import { Menu, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SumiMark } from "@/components/sumi-mark";
import { CommandPalette, ShortcutHint } from "./command-palette";
import { NAV_GROUPS } from "./nav-items";
import { PrivacyToggle } from "./privacy";
import { ThemeToggle } from "./theme";
import { PageTransition } from "./page-transition";
import { Button } from "./ui/button";
import { HoverHint } from "./ui/tooltip";

const SIDEBAR_COLLAPSED_KEY = "journal-sidebar-collapsed-v1";

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  collapsed = false,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  active: boolean;
  collapsed?: boolean;
}) {
  return (
    <HoverHint content={collapsed ? label : null} side="right">
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "journal-sidebar-nav-link relative flex h-10 items-center gap-2.5 rounded-full px-3.5 text-[15px] transition-colors",
          active
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent/55 hover:text-foreground",
        )}
      >
        <Icon className={cn("size-4", active && "text-brand")} strokeWidth={1.65} />
        <span className="journal-sidebar-label">{label}</span>
      </Link>
    </HoverHint>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarReady, setSidebarReady] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  useEffect(() => {
    const read = () => {
      try {
        setSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
      } catch {
        setSidebarCollapsed(false);
      } finally {
        setSidebarReady(true);
      }
    };
    read();
    const sync = (event: StorageEvent) => {
      if (event.key === SIDEBAR_COLLAPSED_KEY || event.key === null) read();
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "b") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      toggleSidebar();
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  function toggleSidebar() {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // The interaction still works when storage is unavailable.
      }
      return next;
    });
  }
  const filterQuery = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = search.get(key);
    if (value) filterQuery.set(key, value);
  }
  if (search.get("range")) filterQuery.set("range", search.get("range")!);
  if (pathname === "/login") return <>{children}</>;
  const navigation = (collapsed = false) => (
    <nav
      aria-label="Journal navigation"
      className="journal-sidebar-navigation min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-3 pb-2"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a")) setMenuOpen(false);
      }}
    >
      {NAV_GROUPS.map((group) => {
        const labelId = `journal-nav-${group.label.toLowerCase()}${collapsed ? "" : "-open"}`;
        return (
          <div
            key={group.label}
            role="group"
            aria-labelledby={labelId}
            className="journal-sidebar-group space-y-0.5"
          >
            <p
              id={labelId}
              className="journal-sidebar-eyebrow px-3.5 pb-1.5 pt-4 font-mono text-[11px] uppercase leading-none tracking-[0.08em] text-muted-foreground"
            >
              {group.label}
            </p>
            {group.items.map(({ href, label, icon }) => (
              <NavLink
                key={href}
                href={href === "/prop-firms" || !filterQuery.size ? href : `${href}?${filterQuery}`}
                label={label}
                icon={icon}
                collapsed={collapsed}
                active={href === "/" ? pathname === "/" : pathname.startsWith(href)}
              />
            ))}
          </div>
        );
      })}
    </nav>
  );
  const sidebarActions = (collapsed: boolean) => (
    <div className="journal-sidebar-footer flex flex-col gap-2 p-3 pt-2">
      <HoverHint content={collapsed ? "Search and commands" : null} side="right">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="journal-sidebar-search h-9 w-full justify-start gap-2 px-3 text-muted-foreground hover:text-foreground"
          onClick={() => setPaletteOpen(true)}
          aria-label="Open command palette"
          aria-keyshortcuts="Meta+K Control+K"
        >
          <Search strokeWidth={1.65} />
          <span className="journal-sidebar-label">Search</span>
          <ShortcutHint className="journal-sidebar-label ml-auto" />
        </Button>
      </HoverHint>
      <div className="journal-sidebar-actions flex items-center gap-1">
        <ThemeToggle iconOnly className="h-9 w-9" />
        <PrivacyToggle compact={!collapsed} iconOnly={collapsed} />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="journal-sidebar-trigger ml-auto h-9 w-9 text-muted-foreground hover:text-foreground"
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!sidebarCollapsed}
          aria-keyshortcuts="Meta+B Control+B"
          title={`${sidebarCollapsed ? "Expand" : "Collapse"} sidebar (⌘B)`}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen strokeWidth={1.65} />
          ) : (
            <PanelLeftClose strokeWidth={1.65} />
          )}
        </Button>
      </div>
      <p className="journal-sidebar-note px-1 text-xs leading-snug text-muted-foreground">
        Local first. Not investment advice.
      </p>
    </div>
  );
  return (
    <div className="journal-shell min-h-dvh lg:flex">
      <header className="journal-mobile-header sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur lg:hidden">
        <DialogPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <DialogPrimitive.Trigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              aria-label="Open navigation"
            >
              <Menu />
            </Button>
          </DialogPrimitive.Trigger>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="journal-nav-overlay fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" />
            <DialogPrimitive.Content
              className="journal-nav-drawer fixed inset-y-0 left-0 z-50 flex w-[min(288px,calc(100vw-40px))] flex-col border-r bg-card shadow-2xl"
              aria-describedby={undefined}
            >
              <div className="flex h-14 shrink-0 items-center gap-2.5 px-5">
                <SumiMark className="h-[22px] w-[22px] text-brand" />
                <DialogPrimitive.Title className="journal-brand text-[21px] font-normal">
                  Sumi<span className="text-brand">.</span>
                </DialogPrimitive.Title>
                <DialogPrimitive.Close asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto h-9 w-9"
                    aria-label="Close navigation"
                  >
                    <X />
                  </Button>
                </DialogPrimitive.Close>
              </div>
              {navigation()}
              <div className="flex flex-col gap-2 p-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 w-full justify-start gap-2 px-3 text-muted-foreground"
                  onClick={() => {
                    setMenuOpen(false);
                    setPaletteOpen(true);
                  }}
                >
                  <Search strokeWidth={1.65} />
                  Search and commands
                </Button>
                <PrivacyToggle />
                <p className="px-1 text-xs leading-snug text-muted-foreground">
                  Local first. Not investment advice.
                </p>
              </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
        <Link href="/" className="mr-auto flex min-w-0 items-center gap-2">
          <SumiMark className="hidden h-4 w-[18px] shrink-0 text-brand min-[380px]:block" />
          <span className="journal-brand truncate text-[21px] font-normal">
            Sumi<span className="text-brand">.</span>
          </span>
        </Link>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          aria-label="Open command palette"
          onClick={() => setPaletteOpen(true)}
        >
          <Search strokeWidth={1.65} />
        </Button>
        <PrivacyToggle compact />
        <ThemeToggle iconOnly />
      </header>
      <aside
        className="journal-desktop-sidebar sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-background lg:flex"
        data-collapsed={sidebarCollapsed}
        data-ready={sidebarReady}
      >
        <div className="journal-sidebar-header flex h-16 shrink-0 items-center">
          <Link href="/" className="journal-sidebar-home flex h-full min-w-0 items-center gap-2.5">
            <SumiMark className="h-[22px] w-[22px] shrink-0 text-brand" />
            <span className="journal-sidebar-brand-label">
              Sumi<span className="text-brand">.</span>
            </span>
          </Link>
        </div>
        {navigation(sidebarCollapsed)}
        {sidebarActions(sidebarCollapsed)}
      </aside>
      <PageTransition>{children}</PageTransition>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onToggleSidebar={toggleSidebar}
        filterQuery={filterQuery.toString()}
      />
    </div>
  );
}
