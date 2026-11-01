// Icons, from the settled prototype. They draw in currentColor.

const common = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  "aria-hidden": true,
} as const;

export const TodayIcon = () => (
  <svg {...common}>
    <rect x="3.5" y="5" width="17" height="15" rx="3" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
    <circle cx="12" cy="15" r="1.6" fill="currentColor" />
  </svg>
);

export const PactsIcon = () => (
  <svg {...common}>
    <path d="M6 3.5h9l3.5 3.5v13.5H6z" />
    <path d="M9 11h6M9 14.5h6M9 18h3.5" />
  </svg>
);

export const ReviewIcon = () => (
  <svg {...common}>
    <rect x="3.5" y="6" width="17" height="13.5" rx="3" />
    <path d="M8 3.5h8M8.5 12.5l2.5 2.5 4.5-5" />
  </svg>
);

export const LedgersIcon = () => (
  <svg {...common}>
    <path d="M5 4.5h11.5a2.5 2.5 0 0 1 2.5 2.5v12.5H7.5A2.5 2.5 0 0 1 5 17z" />
    <path d="M5 17a2.5 2.5 0 0 1 2.5-2.5H19M9 8.5h6" />
  </svg>
);

/** Safari's Share button, as the setup guide describes it. */
export const ShareIcon = () => (
  <svg {...common} className="inline-ico">
    <path d="M12 15V3.5M8 7l4-3.5L16 7" />
    <path d="M8.5 10.5H6v10h12v-10h-2.5" />
  </svg>
);

/** Safari's Add to Home Screen row. */
export const AddIcon = () => (
  <svg {...common} className="inline-ico">
    <rect x="4" y="4" width="16" height="16" rx="3.5" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);

export const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"
    />
    <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8z" />
    <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
  </svg>
);

export const BackIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </svg>
);

export const CameraIcon = () => (
  <svg {...common}>
    <path d="M4 8.5A2 2 0 0 1 6 6.5h2l1.5-2h5l1.5 2h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    <circle cx="12" cy="13" r="3.6" />
  </svg>
);

export const RingIcon = () => (
  <svg {...common}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="5" />
  </svg>
);

export const DollarIcon = () => (
  <svg {...common} strokeWidth={1.9}>
    <path d="M15.5 8.2c-.6-1.2-1.9-1.9-3.6-1.9-2 0-3.4 1-3.4 2.5 0 3.5 7.3 1.9 7.3 5.5 0 1.6-1.6 2.7-3.9 2.7-1.8 0-3.2-.8-3.8-2.1M12 4v16" />
  </svg>
);
