"use client";

import { useSyncExternalStore } from "react";

/** Per-user row density for data tables (Trades and Reports). Stored only in this browser. */
export const TABLE_DENSITY_KEY = "journal-table-density-v1";
export type TableDensity = "comfortable" | "compact";

const listeners = new Set<() => void>();
let memory: TableDensity = "comfortable";

export function readTableDensity(): TableDensity {
  try {
    const stored = localStorage.getItem(TABLE_DENSITY_KEY);
    if (stored === "compact" || stored === "comfortable") return stored;
  } catch {
    // Storage can be blocked; the in-memory choice still applies for this session.
    return memory;
  }
  return "comfortable";
}

export function writeTableDensity(density: TableDensity) {
  memory = density;
  try {
    localStorage.setItem(TABLE_DENSITY_KEY, density);
  } catch {
    // Not persisted, but still applied for this session.
  }
  listeners.forEach((notify) => notify());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === TABLE_DENSITY_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
};

/** Current density and a setter. Server render and first paint use "comfortable". */
export function useTableDensity(): [TableDensity, (density: TableDensity) => void] {
  const density = useSyncExternalStore(
    subscribe,
    readTableDensity,
    (): TableDensity => "comfortable",
  );
  return [density, writeTableDensity];
}
