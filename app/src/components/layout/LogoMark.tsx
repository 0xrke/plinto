/** Logo: a rising price line resting on a solid floor. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden focusable="false">
      <rect x="0" y="0" width="28" height="28" rx="7" fill="var(--color-brand)" />
      <path
        d="M6 16.5 L11 12 L14.5 14.5 L22 7.5"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="5" y="19.5" width="18" height="3.5" rx="1.2" fill="#7fd1ad" />
    </svg>
  );
}
