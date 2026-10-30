/**
 * The brand mark: authentic auctioneer gavel (malhete de leilão) striking its wooden sounding block.
 * Features an authentic turned barrel head with brass bands, turned handle with contoured grip and finial knob,
 * and a stepped plinth sounding block.
 */
export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 64 48" width="48" height="36" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        {/* Sounding block / Bloco de som do leiloeiro */}
        {/* Plinto base largo */}
        <path
          d="M 6 44 L 46 44 L 43 40 L 9 40 Z"
          fill="currentColor"
          fillOpacity="0.12"
          strokeWidth="1.8"
        />
        {/* Prato de impacto central com acabamento em latão dourado */}
        <rect
          x="14"
          y="36"
          width="24"
          height="4"
          rx="1"
          fill="currentColor"
          fillOpacity="0.06"
          strokeWidth="1.6"
        />
        <line x1="16" y1="36" x2="36" y2="36" stroke="#c5a153" strokeWidth="1.8" />

        {/* Martelo de leilão (Malhete / Gavel) em ângulo clássico de batida */}
        <g transform="translate(24 23) rotate(-34)">
          {/* Cabo torneado clássico (Handle) */}
          {/* Engaste de latão onde o cabo entra na cabeça */}
          <rect x="-1.8" y="-12.5" width="3.6" height="3.5" rx="0.6" fill="#c5a153" stroke="#c5a153" strokeWidth="1" />
          
          {/* Haste de madeira afilada */}
          <path
            d="M -1.3 -12.5 L -1 -24 Q -1.6 -29 -2.2 -32 Q -2.8 -34 -1.8 -36.5 L 1.8 -36.5 Q 2.8 -34 2.2 -32 Q 1.6 -29 1 -24 L 1.3 -12.5 Z"
            fill="currentColor"
            fillOpacity="0.25"
            strokeWidth="1.4"
          />
          {/* Anel decorativo de latão na empunhadura */}
          <line x1="-2.2" y1="-32" x2="2.2" y2="-32" stroke="#c5a153" strokeWidth="1.4" />
          {/* Pomo esférico final (Knob / Finial) */}
          <circle cx="0" cy="-38.5" r="2.2" fill="#c5a153" stroke="currentColor" strokeWidth="1.4" />

          {/* Cabeça em formato de barril cilíndrico simétrico (Gavel Head / Barrel) */}
          {/* Corpo principal de madeira torneada */}
          <rect
            x="-13"
            y="-6"
            width="26"
            height="12"
            rx="2.5"
            fill="currentColor"
            fillOpacity="0.18"
            strokeWidth="1.8"
          />

          {/* Anel central em latão dourado polido (Brass presentation band) */}
          <rect
            x="-2.5"
            y="-6.8"
            width="5"
            height="13.6"
            rx="0.8"
            fill="#c5a153"
            stroke="#c5a153"
            strokeWidth="1"
          />

          {/* Anéis torneados secundários próximos às cabeças */}
          <line x1="-8.5" y1="-5.8" x2="-8.5" y2="5.8" stroke="#c5a153" strokeWidth="1.2" />
          <line x1="8.5" y1="-5.8" x2="8.5" y2="5.8" stroke="#c5a153" strokeWidth="1.2" />

          {/* Face esquerda de impacto com rebordo abaulado */}
          <path
            d="M -13 -6.5 C -15.5 -6.5 -16 -4.5 -16 0 C -16 4.5 -15.5 6.5 -13 6.5 Z"
            fill="currentColor"
            fillOpacity="0.28"
            strokeWidth="1.6"
          />

          {/* Face direita de impacto com rebordo abaulado */}
          <path
            d="M 13 -6.5 C 15.5 -6.5 16 -4.5 16 0 C 16 4.5 15.5 6.5 13 6.5 Z"
            fill="currentColor"
            fillOpacity="0.28"
            strokeWidth="1.6"
          />
        </g>
      </g>
    </svg>
  );
}
