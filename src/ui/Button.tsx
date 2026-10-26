import { forwardRef, isValidElement, type ButtonHTMLAttributes, type ComponentType, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Tooltip } from "./Tooltip";
import type { Side } from "./floating";

export type ButtonVariant = "primary" | "subtle" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

/** An icon is either a lucide component (Camera) or an element (<Camera />). */
export type IconLike = ComponentType<{ size?: number; strokeWidth?: number; className?: string }> | ReactNode;

const ICON_PX: Record<ButtonSize, number> = { sm: 14, md: 15, lg: 17 };

export function renderIcon(icon: IconLike, size: number, className?: string): ReactNode {
  if (!icon) return null;
  if (isValidElement(icon)) return icon;
  if (typeof icon === "function" || (typeof icon === "object" && icon !== null && "$$typeof" in (icon as object))) {
    const C = icon as ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
    return <C size={size} strokeWidth={1.75} className={className} />;
  }
  return icon as ReactNode;
}

interface ButtonBaseProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconLike;
  iconRight?: IconLike;
  /** Shows a spinner in place of the icon and blocks clicks. */
  loading?: boolean;
  /** Stretch to the container width. */
  block?: boolean;
}

/** A button with text children, or (icon only) one that names itself with aria-label / aria-labelledby:
 *  a screen reader must never announce just "button". */
export type ButtonProps = ButtonBaseProps & (
  | { children: ReactNode; "aria-label"?: string }
  | { children?: undefined; "aria-label": string }
  | { children?: undefined; "aria-labelledby": string }
);

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "subtle", size = "md", icon, iconRight, loading, block, className, children, disabled, type = "button", ...rest }, ref) {
  const px = ICON_PX[size];
  return (
    <button
      ref={ref}
      type={type}
      className={`cs-btn cs-btn-${variant} cs-btn-${size}${block ? " cs-btn-block" : ""}${children ? "" : " cs-btn-icononly"}${className ? " " + className : ""}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 size={px} className="cs-spin" aria-hidden /> : renderIcon(icon, px)}
      {children !== undefined && children !== null && children !== false && <span className="cs-btn-label">{children}</span>}
      {renderIcon(iconRight, px)}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconLike;
  /** Accessible name, also the tooltip title. */
  label: string;
  /** One line explaining what it does, shown under the label in the tooltip. */
  hint?: ReactNode;
  shortcut?: string;
  /** Pressed / on state for toggles. */
  active?: boolean;
  size?: ButtonSize;
  variant?: Exclude<ButtonVariant, "primary"> | "primary";
  tooltipSide?: Side;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, hint, shortcut, active, size = "md", variant = "ghost", tooltipSide = "bottom", className, type = "button", ...rest }, ref) {
  const btn = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      className={`cs-btn cs-btn-${variant} cs-btn-${size} cs-btn-icononly${active ? " is-active" : ""}${className ? " " + className : ""}`}
      {...rest}
    >
      {renderIcon(icon, ICON_PX[size])}
    </button>
  );
  return <Tooltip title={label} content={hint} shortcut={shortcut} side={tooltipSide}>{btn}</Tooltip>;
});
