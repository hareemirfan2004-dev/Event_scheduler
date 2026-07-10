"use client";
import { useSyncExternalStore } from "react";

export interface SavedGroup {
  code: string;
  groupName: string;
  memberName: string;
  lastOpenedAt: number;
}

const KEY = "saath:groups";

export function upsertGroup(list: SavedGroup[], g: SavedGroup): SavedGroup[] {
  const code = g.code.toUpperCase();
  const rest = list.filter((x) => x.code.toUpperCase() !== code);
  return [{ ...g, code }, ...rest].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export function removeFromList(list: SavedGroup[], code: string): SavedGroup[] {
  return list.filter((x) => x.code.toUpperCase() !== code.toUpperCase());
}

let cache: SavedGroup[] | null = null;
const listeners = new Set<() => void>();

function read(): SavedGroup[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedGroup[]) : [];
  } catch { return []; }
}
function write(list: SavedGroup[]) {
  window.localStorage.setItem(KEY, JSON.stringify(list));
  cache = list;
  for (const l of listeners) l();
}

export function getGroups(): SavedGroup[] {
  if (typeof window === "undefined") return [];
  if (cache == null) cache = read();
  return cache;
}
export function saveGroup(g: SavedGroup): void { write(upsertGroup(getGroups(), g)); }
export function removeGroup(code: string): void { write(removeFromList(getGroups(), code)); }
export function touchGroup(code: string): void {
  const existing = getGroups().find((x) => x.code.toUpperCase() === code.toUpperCase());
  if (existing) write(upsertGroup(getGroups(), { ...existing, lastOpenedAt: Date.now() }));
}

function subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); }

export function useMyGroups(): SavedGroup[] {
  return useSyncExternalStore(subscribe, getGroups, () => []);
}
