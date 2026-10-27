/** The brand mark: a gavel over a base, the auction's hammer. Used in the header. */
export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 24 24" width="36" height="36" aria-hidden="true" focusable="false">
      <g transform="rotate(-35 12 12)" fill="currentColor">
        <rect x="2.5" y="1.5" width="13" height="7" rx="2" />
        <rect x="10" y="7.5" width="4" height="13.5" rx="1.5" />
      </g>
      <rect x="3" y="20.5" width="18" height="3" rx="1.5" fill="currentColor" />
    </svg>
  );
}
