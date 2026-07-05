"use client";

import type { ReactNode } from "react";

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabled,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "quiet";
  disabled?: boolean;
  className?: string;
}) {
  const base =
    "rounded-xl px-4 py-3 text-base font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const look =
    variant === "primary"
      ? "bg-leaf text-white active:bg-leaf-deep"
      : "border border-hairline bg-card text-ink active:bg-paper";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${look} ${className}`}
    >
      {children}
    </button>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-soft">
        {label}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-hairline bg-card px-3 py-3 text-base text-ink placeholder:text-ink-soft/60"
      />
    </label>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-hairline bg-card p-4 shadow-[0_1px_2px_rgba(33,42,59,0.04)] ${className}`}
    >
      {children}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="rounded-lg bg-strike-wash px-3 py-2 text-sm text-strike">
      {children}
    </p>
  );
}
