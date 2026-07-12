import type { InputHTMLAttributes } from "react";
import { forwardRef } from "react";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className = "", ...props }, ref) {
  return <input className={`ui-input ${className}`} ref={ref} {...props} />;
});
