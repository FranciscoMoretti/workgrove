import type { ButtonHTMLAttributes } from "react";
import { forwardRef } from "react";

type ButtonVariant = "default" | "destructive" | "ghost" | "secondary";
type ButtonSize = "default" | "icon" | "sm";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  default: "primary",
  destructive: "danger",
  ghost: "ghost",
  secondary: "secondary",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  default: "",
  icon: "icon-button",
  sm: "tiny",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: ButtonSize;
    variant?: ButtonVariant;
  }
>(function Button(
  {
    className = "",
    size = "default",
    type = "button",
    variant = "default",
    ...props
  },
  ref
) {
  return (
    <button
      className={`button ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      ref={ref}
      type={type}
      {...props}
    />
  );
});
