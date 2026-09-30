/**
 * Line glyphs, 24px grid, 2px stroke, `currentColor` throughout.
 *
 * Inline rather than an icon package: seven icons do not justify a dependency, and
 * `currentColor` is what lets every one of them follow the theme tokens (module 16 §1).
 */
type IconProps = { size?: number; className?: string };

const base = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  className,
});

export const ShirtIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M8 3 4 5v5h3v11h10V10h3V5l-4-2a4 4 0 0 1-8 0Z" />
  </svg>
);

export const HomeIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
  </svg>
);

export const UploadIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M12 16V4" />
    <path d="m7 9 5-5 5 5" />
    <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
);

export const HangerIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M12 8a2.5 2.5 0 1 1 2.5-2.5" />
    <path d="M12 8v2.5L3.6 16a1.4 1.4 0 0 0 .8 2.6h15.2a1.4 1.4 0 0 0 .8-2.6L12 10.5" />
  </svg>
);

export const SparkleIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z" />
    <path d="M18.5 15.5 19 17l1.5.5L19 18l-.5 1.5L18 18l-1.5-.5L18 17Z" />
  </svg>
);

export const TrashIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size, className)}>
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export const SettingsIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="3.2" />
    <circle cx="12" cy="12" r="8.4" strokeDasharray="2.6 3.2" />
  </svg>
);

export const ImageOffIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="m3 16 5-5 4 4" />
    <circle cx="15" cy="9" r="1.4" />
  </svg>
);

export const CalendarIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
  </svg>
);

export const GridIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size, className)}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
  </svg>
);
