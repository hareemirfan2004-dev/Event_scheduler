// The two signature marks: a red felt-pen X for busy days and a green
// pen circle for the day that works.

export function StrikeX() {
  return (
    <svg className="strike" viewBox="0 0 32 32" aria-hidden="true">
      <line x1="7" y1="7" x2="25" y2="25" />
      <line x1="25" y1="7" x2="7" y2="25" style={{ animationDelay: "70ms" }} />
    </svg>
  );
}

export function PenCircle() {
  return (
    <svg className="pen-circle" viewBox="0 0 64 40" aria-hidden="true">
      <ellipse cx="32" cy="20" rx="28" ry="15" />
    </svg>
  );
}
