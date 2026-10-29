// Tab icons, from the settled prototype. They draw in currentColor.

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

export const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" />
    <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
    <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8z" />
    <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
  </svg>
);
