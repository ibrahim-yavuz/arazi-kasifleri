/** Game logo: compass badge with mountains and a dirt road, plus the title ribbon. */
export const LOGO_SVG = `<svg class="logo-svg" viewBox="0 0 360 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Arazi Kaşifleri">
  <defs>
    <linearGradient id="lg-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5fd0e8"/><stop offset="1" stop-color="#bff0d8"/></linearGradient>
    <linearGradient id="lg-rib" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a3c"/><stop offset="1" stop-color="#d8431a"/></linearGradient>
    <clipPath id="lg-clip"><circle cx="180" cy="88" r="76"/></clipPath>
  </defs>
  <circle cx="180" cy="88" r="86" fill="#2c3a2e"/>
  <circle cx="180" cy="88" r="81" fill="#f3d27a"/>
  <g clip-path="url(#lg-clip)">
    <rect x="100" y="8" width="160" height="160" fill="url(#lg-sky)"/>
    <circle cx="214" cy="52" r="17" fill="#ffe25a"/>
    <path d="M96 128 L150 46 L176 84 L198 58 L262 128 Z" fill="#5f8f4a"/>
    <path d="M150 46 L163 66 L155 63 L148 70 L141 60 Z M198 58 L208 72 L201 70 L195 75 L190 68 Z" fill="#ffffff"/>
    <path d="M96 168 L96 116 C130 100 230 100 264 116 L264 168 Z" fill="#8fbf4a"/>
    <path d="M168 168 C176 146 196 136 184 120 C178 112 188 106 196 104 L201 105 C194 109 190 114 196 122 C210 140 194 152 196 168 Z" fill="#c8894a"/>
  </g>
  <g transform="translate(180 88)">
    <path d="M0 -86 L6 -74 L0 -78 L-6 -74 Z" fill="#d8431a"/>
    <path d="M0 86 L6 74 L0 78 L-6 74 Z M-86 0 L-74 6 L-78 0 L-74 -6 Z M86 0 L74 6 L78 0 L74 -6 Z" fill="#2c3a2e"/>
  </g>
  <path d="M14 122 L52 122 L44 140 L52 158 L14 158 L24 140 Z" fill="#a8320f"/>
  <path d="M346 122 L308 122 L316 140 L308 158 L346 158 L336 140 Z" fill="#a8320f"/>
  <path d="M40 116 L320 116 L320 164 L40 164 Z" fill="url(#lg-rib)" stroke="#5a1c06" stroke-width="3"/>
  <text x="180" y="108" text-anchor="middle" class="logo-title">ARAZİ</text>
  <text x="180" y="154" text-anchor="middle" class="logo-sub">KAŞİFLERİ</text>
</svg>`;
