/** The brand mark: a gavel over a base, the auction's hammer. Used in the header and as the favicon. */
export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <g transform="rotate(-35 12 12)" fill="currentColor">
        <rect x="5" y="3" width="10" height="5" rx="1.5" />
        <rect x="10.8" y="8" width="2.4" height="12" rx="1.2" />
      </g>
      <rect x="4" y="21" width="16" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}
