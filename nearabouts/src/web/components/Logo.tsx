export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <path d="M32 6c-11 0-20 9-20 20 0 14 20 32 20 32s20-18 20-32C52 15 43 6 32 6z" fill="#ff6b4a" />
      <circle cx="32" cy="26" r="10" fill="#0b0e14" />
      <path d="M32 18l3.2 8-3.2 8-3.2-8z" fill="#2ed3b7" />
      <path d="M32 26l3.2 0-3.2 8z" fill="#f5c451" />
    </svg>
  );
}
