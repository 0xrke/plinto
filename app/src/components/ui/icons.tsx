import type { ReactNode, SVGProps } from "react";

/**
 * Line icons from the Pastel mockups: 20×20 grid, 1.6–2.2 stroke, round caps. Decorative by
 * default (aria-hidden); give the surrounding control an accessible name.
 */
export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number; strokeWidth?: number };

function Icon({ size = 20, strokeWidth = 1.7, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function HomeIcon({ solid = false, ...props }: IconProps & { solid?: boolean }) {
  return (
    <Icon {...props}>
      <path
        d="M3.5 9.5L10 4l6.5 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-4V17H4.5a1 1 0 0 1-1-1z"
        fill={solid ? "currentColor" : "none"}
      />
    </Icon>
  );
}

export function LayersIcon({ solid = false, ...props }: IconProps & { solid?: boolean }) {
  return (
    <Icon {...props}>
      <path d="M10 3l7 3.5-7 3.5-7-3.5z" fill={solid ? "currentColor" : "none"} />
      <path d="M3 10l7 3.5 7-3.5" />
      <path d="M3 13.5L10 17l7-3.5" />
    </Icon>
  );
}

export function PlusCircleIcon({ solid = false, ...props }: IconProps & { solid?: boolean }) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="7" fill={solid ? "currentColor" : "none"} />
      <path d="M10 7v6M7 10h6" stroke={solid ? "#ffffff" : "currentColor"} />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon size={14} strokeWidth={2.2} {...props}>
      <path d="M7.5 5l5 5-5 5" />
    </Icon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon size={14} strokeWidth={2.2} {...props}>
      <path d="M12.5 5l-5 5 5 5" />
    </Icon>
  );
}

export function ArrowUpRightIcon(props: IconProps) {
  return (
    <Icon size={18} strokeWidth={2} {...props}>
      <path d="M6 14L14 6M7.5 6H14v6.5" />
    </Icon>
  );
}

/** Small outbound arrow after "Waitlist". */
export function ExternalIcon(props: IconProps) {
  return (
    <Icon size={14} strokeWidth={1.8} {...props}>
      <path d="M7 13l6-6M8 7h5v5" />
    </Icon>
  );
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <Icon size={16} strokeWidth={2} {...props}>
      <path d="M10 4v12M5 11l5 5 5-5" />
    </Icon>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <Icon size={17} strokeWidth={2} {...props}>
      <path d="M10 16V4M5 9l5-5 5 5" />
    </Icon>
  );
}

/** Redeem: download into a tray. */
export function RedeemIcon(props: IconProps) {
  return (
    <Icon size={18} strokeWidth={2} {...props}>
      <path d="M3.5 16.5h13" />
      <path d="M10 3.5v9M6 9l4 4 4-4" />
    </Icon>
  );
}

export function WalletIcon(props: IconProps) {
  return (
    <Icon size={18} strokeWidth={1.6} {...props}>
      <rect x="3" y="5.5" width="14" height="10" rx="2.5" />
      <path d="M3 8.5h14" />
      <circle cx="13.5" cy="12" r=".9" fill="currentColor" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon size={18} strokeWidth={2.2} {...props}>
      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
    </Icon>
  );
}

/** Floor live: a rising line over a base line. */
export function FloorChartIcon(props: IconProps) {
  return (
    <Icon strokeWidth={2} {...props}>
      <path d="M3.5 12.5l4-4 3 2.5 5.5-6" />
      <path d="M3.5 16.5h13" />
    </Icon>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Icon size={18} {...props}>
      <rect x="4" y="9" width="12" height="8" rx="2.5" />
      <path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" />
    </Icon>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <Icon size={17} strokeWidth={1.8} {...props}>
      <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1" />
      <path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1" />
    </Icon>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Icon size={15} {...props}>
      <rect x="7" y="7" width="10" height="10" rx="2.5" />
      <path d="M13 4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13" />
    </Icon>
  );
}

/** Vault balance: a safe. */
export function VaultIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="14" height="12" rx="3" />
      <circle cx="10" cy="10" r="2.5" />
    </Icon>
  );
}

/** Token supply: a stack of coins. */
export function SupplyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <ellipse cx="10" cy="6" rx="6" ry="2.5" />
      <path d="M4 6v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V6M4 10v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4" />
    </Icon>
  );
}

/** Floor per token: a step up. */
export function StepIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 16.5h13" />
      <path d="M5 13.5h4v-3h3.5V8H16" />
    </Icon>
  );
}

export function PercentIcon(props: IconProps) {
  return (
    <Icon strokeWidth={1.8} {...props}>
      <path d="M14.5 5.5l-9 9" />
      <circle cx="6.5" cy="6.5" r="2" />
      <circle cx="13.5" cy="13.5" r="2" />
    </Icon>
  );
}

/** A share of a whole: pie. */
export function PieIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 3v7h7" />
    </Icon>
  );
}

export function TrendIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 14l4-4.5 3 2.5 6-6.5" />
      <path d="M12.5 5.5h4v4" />
    </Icon>
  );
}

/** Sell back / swap. */
export function SwapIcon(props: IconProps) {
  return (
    <Icon size={16} strokeWidth={1.8} {...props}>
      <path d="M4 7h11l-3-3M16 13H5l3 3" />
    </Icon>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <Icon size={18} {...props}>
      <rect x="3" y="5" width="14" height="10" rx="2.5" />
      <path d="M4 6.5l6 4.5 6-4.5" />
    </Icon>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Icon size={18} {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 9v4.5M10 6.5v.01" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon size={16} strokeWidth={2} {...props}>
      <path d="M5 5l10 10M15 5L5 15" />
    </Icon>
  );
}
