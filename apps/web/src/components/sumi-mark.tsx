/**
 * Sumi's mark: an ensō, the single brushed ink circle, left open at the top right.
 * It inherits `currentColor`, so it takes the accent wherever it is placed.
 */
export function SumiMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M17.9 6.3A8.4 8.4 0 1 0 20.4 12.6"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
