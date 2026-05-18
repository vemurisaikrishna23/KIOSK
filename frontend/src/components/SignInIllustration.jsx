export default function SignInIllustration() {
  return (
    <svg
      className="signin-illustration"
      viewBox="0 0 620 520"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="screen-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#FDF4EC" />
        </linearGradient>
      </defs>

      {/* Background browser windows */}
      <g opacity="0.55">
        <rect x="40" y="60" width="240" height="170" rx="10" fill="#fff" stroke="#E6DBCC" strokeWidth="1.5" />
        <rect x="40" y="60" width="240" height="22" rx="10" fill="#F4ECE3" stroke="#E6DBCC" strokeWidth="1.5" />
        <circle cx="55" cy="71" r="3" fill="#D9CFC0" />
        <circle cx="66" cy="71" r="3" fill="#D9CFC0" />
        <circle cx="77" cy="71" r="3" fill="#D9CFC0" />
        <rect x="55" y="100" width="180" height="6" rx="3" fill="#ECE3D8" />
        <rect x="55" y="115" width="140" height="6" rx="3" fill="#ECE3D8" />
        <rect x="55" y="130" width="160" height="6" rx="3" fill="#ECE3D8" />
        <rect x="55" y="158" width="80" height="40" rx="6" fill="#FFE9D5" />
        <rect x="145" y="158" width="80" height="40" rx="6" fill="#FCD9C2" />
      </g>

      <g opacity="0.45">
        <rect x="340" y="70" width="210" height="150" rx="10" fill="#fff" stroke="#E6DBCC" strokeWidth="1.5" />
        <rect x="340" y="70" width="210" height="22" rx="10" fill="#F4ECE3" stroke="#E6DBCC" strokeWidth="1.5" />
        <circle cx="355" cy="81" r="3" fill="#D9CFC0" />
        <circle cx="366" cy="81" r="3" fill="#D9CFC0" />
        <rect x="355" y="108" width="150" height="6" rx="3" fill="#ECE3D8" />
        <rect x="355" y="122" width="100" height="6" rx="3" fill="#ECE3D8" />
        <rect x="355" y="146" width="180" height="56" rx="8" fill="#FFE9D5" />
      </g>

      {/* Padlock decoration */}
      <g transform="translate(478 36)">
        <path d="M16 36 V24 a18 18 0 0 1 36 0 V36" fill="none" stroke="#F36A1E" strokeWidth="6" strokeLinecap="round" />
        <rect x="4" y="36" width="60" height="52" rx="10" fill="#F36A1E" />
        <circle cx="34" cy="58" r="5" fill="#fff" />
        <rect x="32" y="58" width="4" height="14" rx="1.5" fill="#fff" />
      </g>

      {/* Plant leaves */}
      <g transform="translate(490 350)">
        <path d="M-30 90 Q 30 110 70 50 Q 20 70 -30 90 Z" fill="#FFE9D5" stroke="#F36A1E" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M-10 88 Q 30 70 60 55" stroke="#F36A1E" strokeWidth="1" fill="none" />
        <path d="M40 80 Q 80 70 100 0 Q 70 40 40 80 Z" fill="#FCD9C2" stroke="#F36A1E" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M55 70 Q 75 50 92 15" stroke="#F36A1E" strokeWidth="1" fill="none" />
      </g>

      {/* Phone (main element) */}
      <g transform="translate(245 130)">
        {/* drop shadow */}
        <rect x="2" y="10" width="170" height="304" rx="26" fill="rgba(20,22,28,0.08)" />
        {/* body */}
        <rect x="0" y="0" width="170" height="304" rx="26" fill="#fff" stroke="#14161C" strokeWidth="2.5" />
        {/* screen */}
        <rect x="10" y="12" width="150" height="280" rx="18" fill="url(#screen-grad)" />
        {/* notch */}
        <rect x="68" y="18" width="34" height="6" rx="3" fill="#14161C" />

        {/* app avatar */}
        <circle cx="85" cy="68" r="20" fill="#FFE9D5" stroke="#F36A1E" strokeWidth="1.5" />
        <circle cx="85" cy="62" r="7" fill="#F36A1E" />
        <path d="M70 82 Q 85 92 100 82 L 100 88 L 70 88 Z" fill="#F36A1E" />

        {/* form fields mockup */}
        <rect x="22" y="105" width="126" height="22" rx="6" fill="#fff" stroke="#F4D9C2" strokeWidth="1" />
        <rect x="28" y="113" width="60" height="4" rx="2" fill="#F36A1E" />
        <rect x="28" y="119" width="80" height="3" rx="1.5" fill="#ECE3D8" />

        <rect x="22" y="135" width="126" height="22" rx="6" fill="#fff" stroke="#F4D9C2" strokeWidth="1" />
        <circle cx="34" cy="146" r="2" fill="#F36A1E" />
        <circle cx="42" cy="146" r="2" fill="#F36A1E" />
        <circle cx="50" cy="146" r="2" fill="#F36A1E" />
        <circle cx="58" cy="146" r="2" fill="#F36A1E" />
        <circle cx="66" cy="146" r="2" fill="#F36A1E" />

        {/* sign-in CTA */}
        <rect x="34" y="174" width="102" height="32" rx="16" fill="#F36A1E" />
        <text
          x="85"
          y="194"
          textAnchor="middle"
          fill="#fff"
          fontFamily="'Plus Jakarta Sans', system-ui, sans-serif"
          fontSize="11"
          fontWeight="800"
          letterSpacing="1.5"
        >
          SIGN IN
        </text>
      </g>

      {/* Person */}
      <g transform="translate(70 230)">
        {/* hair (behind head) */}
        <path d="M22 -2 Q 50 -34 78 -2 Q 86 36 78 62 L 22 62 Q 14 36 22 -2 Z" fill="#2E3340" />
        {/* head */}
        <circle cx="50" cy="14" r="20" fill="#FCD9C2" />
        {/* hair side */}
        <path d="M30 14 Q 24 -8 50 -10 Q 76 -8 70 14 L 70 28 Q 60 24 50 24 Q 40 24 30 28 Z" fill="#2E3340" />
        {/* body / shirt */}
        <path d="M30 34 L 26 100 Q 50 116 74 100 L 70 34 Z" fill="#F36A1E" />
        {/* left arm down */}
        <path d="M30 38 Q 22 70 26 100" stroke="#F36A1E" strokeWidth="14" strokeLinecap="round" fill="none" />
        <circle cx="26" cy="104" r="7" fill="#FCD9C2" />
        {/* right arm reaching to phone */}
        <path d="M 70 42 Q 110 50 158 76" stroke="#F36A1E" strokeWidth="14" strokeLinecap="round" fill="none" />
        <circle cx="158" cy="80" r="7" fill="#FCD9C2" />
        {/* pants */}
        <rect x="30" y="110" width="16" height="80" rx="5" fill="#2E3340" />
        <rect x="54" y="110" width="16" height="80" rx="5" fill="#2E3340" />
        {/* shoes */}
        <rect x="28" y="188" width="20" height="7" rx="3" fill="#14161C" />
        <rect x="52" y="188" width="20" height="7" rx="3" fill="#14161C" />
      </g>

      {/* Floating thumbs-up notification bubble */}
      <g transform="translate(178 174)">
        <path
          d="M0 14 a 14 14 0 0 1 14 -14 h 38 a 14 14 0 0 1 14 14 v 30 a 14 14 0 0 1 -14 14 h -32 l -14 12 v -12 h -6 a 14 14 0 0 1 -14 -14 Z"
          fill="#fff"
          stroke="#E6DBCC"
          strokeWidth="1.5"
        />
        <g transform="translate(22 14)">
          <rect x="0" y="14" width="6" height="16" rx="2" fill="#F36A1E" />
          <path d="M8 14 L 14 4 Q 22 2 22 14 L 24 30 L 8 30 Z" fill="#F36A1E" />
        </g>
      </g>

      {/* Floor shadow under phone */}
      <ellipse cx="330" cy="470" rx="220" ry="12" fill="rgba(20,22,28,0.05)" />
    </svg>
  )
}
