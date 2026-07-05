"use client";

// Per-group identity stored in the browser. No passwords — the token is the
// identity, so clearing storage just means re-claiming your name.
// Exposed to React through useSyncExternalStore so components re-render
// when an identity is saved (e.g. right after joining).

import { useSyncExternalStore } from "react";

export interface StoredIdentity {
  memberId: string;
  memberName: string;
  memberToken: string;
}

const key = (code: string) => `saath:${code.toUpperCase()}`;

// Snapshot cache: useSyncExternalStore needs stable references per read.
const cache = new Map<string, StoredIdentity | null>();
const listeners = new Set<() => void>();

function readIdentity(code: string): StoredIdentity | null {
  try {
    const raw = window.localStorage.getItem(key(code));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredIdentity;
    return parsed.memberToken ? parsed : null;
  } catch {
    return null;
  }
}

export function getIdentity(code: string): StoredIdentity | null {
  if (typeof window === "undefined") return null;
  if (!cache.has(code)) cache.set(code, readIdentity(code));
  return cache.get(code) ?? null;
}

export function saveIdentity(code: string, identity: StoredIdentity): void {
  window.localStorage.setItem(key(code), JSON.stringify(identity));
  cache.set(code, identity);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The member identity for a group code, or null before joining. */
export function useIdentity(code: string): StoredIdentity | null {
  return useSyncExternalStore(
    subscribe,
    () => getIdentity(code),
    () => null, // server render: nobody is signed in
  );
}
