"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useElectronRuntime } from "@/lib/desktop-info";

/** Release page of the Tauri-based desktop app that replaces this Electron one. */
export const ELECTRON_MIGRATION_URL = "https://github.com/xolah88457/Sumi/releases/tag/v0.4.0";
export const ELECTRON_MIGRATION_TITLE = "Sumi has a new desktop app";
export const ELECTRON_MIGRATION_BODY =
  "Version 0.4 is faster and lighter. Quit this app, then download and install the new one. Your journal carries over automatically.";
export const ELECTRON_MIGRATION_DISMISS_KEY = "sumi-electron-migration-dismissed";

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(ELECTRON_MIGRATION_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function DownloadLink() {
  return (
    <Button asChild size="sm">
      <a href={ELECTRON_MIGRATION_URL} target="_blank" rel="noopener noreferrer">
        Download Sumi 0.4
        <ArrowUpRight aria-hidden="true" />
      </a>
    </Button>
  );
}

/**
 * Calm, non-blocking banner at the top of the app shell. Rendered only inside the
 * Electron app (never in a browser or in the Tauri app). "Not now" hides it until the
 * next launch: the choice lives in sessionStorage, which a relaunch clears.
 */
export function ElectronMigrationBanner() {
  const isElectron = useElectronRuntime();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => setDismissed(readDismissed()), []);
  if (!isElectron || dismissed) return null;
  return (
    <div className="px-4 pt-4 lg:px-8" data-testid="electron-migration-banner">
      <Notice
        role="status"
        title={ELECTRON_MIGRATION_TITLE}
        action={
          <>
            <DownloadLink />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                try {
                  sessionStorage.setItem(ELECTRON_MIGRATION_DISMISS_KEY, "1");
                } catch {
                  // Dismissal still applies for this view when storage is unavailable.
                }
                setDismissed(true);
              }}
            >
              Not now
            </Button>
          </>
        }
      >
        {ELECTRON_MIGRATION_BODY}
      </Notice>
    </div>
  );
}

/** Always-visible copy for the About section (Electron only; the caller gates it). */
export function ElectronMigrationNotice() {
  return (
    <Notice
      role="status"
      title={ELECTRON_MIGRATION_TITLE}
      action={<DownloadLink />}
      data-testid="electron-migration-notice"
    >
      {ELECTRON_MIGRATION_BODY}
    </Notice>
  );
}
