/** The brand mark: the auction gavel striking its block. Minimalist monoline architectural style with subtle brass accent. */
export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 64 48" width="48" height="36" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        {/* Sounding block base */}
        <rect x="6" y="38" width="38" height="6" rx="2" fill="currentColor" fillOpacity="0.08" />
        <line x1="3" y1="44" x2="47" y2="44" strokeWidth="2.5" />
        {/* Gavel handle */}
        <line x1="27" y1="22" x2="56" y2="7" strokeWidth="2.6" />
        <line x1="29" y1="25" x2="58" y2="10" strokeWidth="1.4" stroke="#d4a84f" />
        {/* Gavel head */}
        <g transform="rotate(-28 24 21)">
          <rect x="14" y="11" width="20" height="22" rx="3" fill="#d4a84f" fillOpacity="0.22" stroke="currentColor" strokeWidth="2.2" />
          <line x1="14" y1="16" x2="34" y2="16" stroke="#d4a84f" strokeWidth="1.8" />
          <line x1="14" y1="28" x2="34" y2="28" stroke="#d4a84f" strokeWidth="1.8" />
        </g>
      </g>
    </svg>
  );
}
