export default function Icon({ name, size = 20, stroke = 1.8 }) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: stroke,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }
  switch (name) {
    case 'search':
      return (
        <svg {...props}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      )
    case 'plus':
      return (
        <svg {...props}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      )
    case 'bell':
      return (
        <svg {...props}>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10 21a2 2 0 0 0 4 0" />
        </svg>
      )
    case 'moon':
      return (
        <svg {...props}>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )
    case 'sun':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      )
    case 'chevron-down':
      return (
        <svg {...props}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      )
    case 'chevron-left':
      return (
        <svg {...props}>
          <path d="m15 18-6-6 6-6" />
        </svg>
      )
    case 'chevron-right':
      return (
        <svg {...props}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      )
    case 'home':
      return (
        <svg {...props}>
          <path d="M3 11 12 3l9 8" />
          <path d="M5 10v10h14V10" />
        </svg>
      )
    case 'camera':
      return (
        <svg {...props}>
          <rect x="2" y="6" width="14" height="12" rx="2" />
          <path d="m22 8-6 4 6 4z" />
        </svg>
      )
    case 'calendar':
      return (
        <svg {...props}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 9h18M8 3v4M16 3v4" />
        </svg>
      )
    case 'lock':
      return (
        <svg {...props}>
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      )
    case 'bluetooth':
      return (
        <svg {...props}>
          <path d="m7 7 10 10-5 5V2l5 5L7 17" />
        </svg>
      )
    case 'settings':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      )
    case 'user':
      return (
        <svg {...props}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      )
    case 'logout':
      return (
        <svg {...props}>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="m16 17 5-5-5-5M21 12H9" />
        </svg>
      )
    case 'info':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8h.01M11 12h1v4h1" />
        </svg>
      )
    case 'power':
      return (
        <svg {...props}>
          <path d="M12 2v10" />
          <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
        </svg>
      )
    case 'mic':
      return (
        <svg {...props}>
          <rect x="9" y="3" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 19v3" />
        </svg>
      )
    case 'record':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="3" fill="currentColor" />
        </svg>
      )
    case 'screenshot':
      return (
        <svg {...props}>
          <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )
    case 'expand':
      return (
        <svg {...props}>
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </svg>
      )
    case 'play':
      return (
        <svg {...props}>
          <path d="M6 4v16l14-8z" fill="currentColor" />
        </svg>
      )
    case 'pause':
      return (
        <svg {...props}>
          <rect x="7" y="4" width="3" height="16" fill="currentColor" />
          <rect x="14" y="4" width="3" height="16" fill="currentColor" />
        </svg>
      )
    case 'skip-prev':
      return (
        <svg {...props}>
          <path d="M5 4v16M20 4 8 12l12 8z" fill="currentColor" />
        </svg>
      )
    case 'skip-next':
      return (
        <svg {...props}>
          <path d="M19 4v16M4 4l12 8L4 20z" fill="currentColor" />
        </svg>
      )
    case 'more':
      return (
        <svg {...props}>
          <circle cx="12" cy="5" r="1.5" fill="currentColor" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          <circle cx="12" cy="19" r="1.5" fill="currentColor" />
        </svg>
      )
    case 'thermometer':
      return (
        <svg {...props}>
          <path d="M14 4a2 2 0 0 0-4 0v10a4 4 0 1 0 4 0z" />
        </svg>
      )
    case 'wifi':
      return (
        <svg {...props}>
          <path d="M5 12a10 10 0 0 1 14 0" />
          <path d="M8.5 15.5a5 5 0 0 1 7 0" />
          <circle cx="12" cy="19" r="1" fill="currentColor" />
        </svg>
      )
    case 'bulb':
      return (
        <svg {...props}>
          <path d="M9 18h6M10 22h4" />
          <path d="M12 2a7 7 0 0 0-4 12.7c.7.6 1 1.4 1 2.3v1h6v-1c0-.9.3-1.7 1-2.3A7 7 0 0 0 12 2z" />
        </svg>
      )
    case 'heart':
      return (
        <svg {...props}>
          <path d="M12 21s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9z" />
        </svg>
      )
    case 'palette':
      return (
        <svg {...props}>
          <circle cx="7" cy="13" r="1.5" fill="currentColor" />
          <circle cx="12" cy="8" r="1.5" fill="currentColor" />
          <circle cx="17" cy="13" r="1.5" fill="currentColor" />
          <path d="M12 2a10 10 0 1 0 0 20c1 0 1.5-.8 1.5-1.5S13 19 13 18s.5-1.5 1.5-1.5H17a5 5 0 0 0 5-5A10 10 0 0 0 12 2z" />
        </svg>
      )
    case 'battery':
      return (
        <svg {...props}>
          <rect x="2" y="8" width="16" height="8" rx="2" />
          <rect x="4" y="10" width="6" height="4" fill="currentColor" />
          <path d="M20 11v2" />
        </svg>
      )
    case 'clock':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      )
    case 'fan':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="2" />
          <path d="M12 2a4 4 0 0 1 0 8M12 22a4 4 0 0 1 0-8M22 12a4 4 0 0 1-8 0M2 12a4 4 0 0 1 8 0" />
        </svg>
      )
    case 'snow':
      return (
        <svg {...props}>
          <path d="M12 2v20M4.2 4.2l15.6 15.6M20 4 4 20M22 12H2" />
        </svg>
      )
    case 'timer':
      return (
        <svg {...props}>
          <circle cx="12" cy="13" r="8" />
          <path d="M9 2h6M12 9v4l3 1" />
        </svg>
      )
    case 'shield':
      return (
        <svg {...props}>
          <path d="M12 2 4 6v6c0 4.5 3 8.5 8 10 5-1.5 8-5.5 8-10V6z" />
        </svg>
      )
    case 'door':
      return (
        <svg {...props}>
          <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18" />
          <path d="M3 22h18M14 12h.01" />
        </svg>
      )
    case 'motion':
      return (
        <svg {...props}>
          <circle cx="6" cy="6" r="2" />
          <path d="m13 18 4-4-3-3-7 7M8 14l3 3" />
        </svg>
      )
    case 'alert':
      return (
        <svg {...props}>
          <path d="M12 3 2 21h20z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      )
    case 'leaf':
      return (
        <svg {...props}>
          <path d="M21 3c-9 0-15 6-15 15a9 9 0 0 0 9-9c0-3 3-6 6-6z" />
          <path d="M6 21c3-3 6-9 15-18" />
        </svg>
      )
    case 'globe':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
        </svg>
      )
    case 'moon-stars':
      return (
        <svg {...props}>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          <path d="m18 4 .8 1.8L20.6 6l-1.8.8L18 8.6l-.8-1.8L15.4 6l1.8-.6z" />
        </svg>
      )
    case 'key':
      return (
        <svg {...props}>
          <circle cx="8" cy="15" r="4" />
          <path d="m10.8 12.2 9.2-9.2M16 7l3 3M14 9l3 3" />
        </svg>
      )
    case 'menu':
      return (
        <svg {...props}>
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      )
    case 'close':
      return (
        <svg {...props}>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      )
    case 'check':
      return (
        <svg {...props}>
          <path d="M5 12l4 4L19 6" />
        </svg>
      )
    case 'arrow-right':
      return (
        <svg {...props}>
          <path d="M5 12h14M13 5l7 7-7 7" />
        </svg>
      )
    case 'envelope':
      return (
        <svg {...props}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </svg>
      )
    case 'eye':
      return (
        <svg {...props}>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )
    case 'speaker':
      return (
        <svg {...props}>
          <path d="M9 18V6l12-2v12" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      )
    case 'router':
      return (
        <svg {...props}>
          <path d="M5 12a10 10 0 0 1 14 0" />
          <path d="M8.5 15.5a5 5 0 0 1 7 0" />
          <circle cx="12" cy="19" r="1" fill="currentColor" />
        </svg>
      )
    default:
      return null
  }
}
