/** Logo: a rising price line over a floor that thickens to the right, on the indigo tile. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden focusable="false">
      <rect width="64" height="64" rx="16" fill="var(--color-brand-tile)" />
      <path
        d="M14 50.5h36v-8l-36 4.5z"
        fill="var(--color-mint)"
        stroke="var(--color-mint)"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path
        d="M13.7 37.7L25.1 27.4l8 5.7L50.3 17.1"
        fill="none"
        stroke="#ffffff"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="50.3" cy="17.1" r="4.2" fill="var(--color-butter)" />
    </svg>
  );
}
