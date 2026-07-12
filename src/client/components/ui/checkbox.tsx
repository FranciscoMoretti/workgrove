import { type CheckboxProps, Indicator, Root } from "@radix-ui/react-checkbox";
import { CheckIcon } from "lucide-react";
import { forwardRef } from "react";

export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(
  function Checkbox({ className = "", ...props }, ref) {
    return (
      <Root className={`ui-checkbox ${className}`} ref={ref} {...props}>
        <Indicator className="ui-checkbox-indicator">
          <CheckIcon />
        </Indicator>
      </Root>
    );
  }
);
