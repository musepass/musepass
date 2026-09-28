export function BrandMark({ color = 'var(--accent)' }: { color?: string }) {
  return (
    <svg width="30" height="22" viewBox="0 0 30 22" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="28" height="20" rx="4" stroke={color} strokeWidth="2" />
      <path d="M6 15h18M6 10h9" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
