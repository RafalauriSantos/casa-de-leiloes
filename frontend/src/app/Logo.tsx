/** The brand mark: the auction gavel striking its block. The head is gold; the rest takes the text color. Used in the header. */
export function Logo() {
  return (
    <svg className="logo" viewBox="330 250 360 280" width="46" height="36" aria-hidden="true" focusable="false">
      <g transform="translate(0 -40)" fill="currentColor" stroke="currentColor" strokeWidth="10" strokeLinejoin="round">
        <rect x="340" y="500" width="320" height="56" rx="8" />
        <g transform="rotate(15 474.5 498.8)">
          <polygon points="460.9,420.3 623.5,257.6 605.3,239.3 442.7,402" />
          <path d="M555.8 288.8L574.3 307.2" stroke="#d4a84f" strokeWidth="7" strokeLinecap="round" fill="none" />
          <rect x="375.3" y="370.8" width="156" height="92" rx="14" transform="rotate(45 453.3 416.8)" fill="#d4a84f" />
        </g>
      </g>
    </svg>
  );
}
