import type { SVGProps } from 'react';
type Props = SVGProps<SVGSVGElement> & { size?: number };
function Svg({ size = 16, children, ...props }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}
export function ArrowUpRight(p: Props) {
  return (
    <Svg {...p}>
      <path d="M7 17 17 7M7 7h10v10" />
    </Svg>
  );
}
export function RefreshCw(p: Props) {
  return (
    <Svg {...p}>
      <path d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3" />
    </Svg>
  );
}
export function Globe(p: Props) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18" />
    </Svg>
  );
}
export function Clock3(p: Props) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5h4" />
    </Svg>
  );
}
export function Bell(p: Props) {
  return (
    <Svg {...p}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
    </Svg>
  );
}
export function Mail(p: Props) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 6 9 7 9-7" />
    </Svg>
  );
}
export function Smartphone(p: Props) {
  return (
    <Svg {...p}>
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <path d="M11 18h2" />
    </Svg>
  );
}
