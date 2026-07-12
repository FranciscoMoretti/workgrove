import {
  Content,
  Item,
  ItemIndicator,
  Label,
  Portal,
  RadioGroup,
  RadioItem,
  Root,
  Separator,
  Trigger,
} from "@radix-ui/react-dropdown-menu";
import { CheckIcon } from "lucide-react";
import type { ComponentProps } from "react";

export const DropdownMenu = Root;
export const DropdownMenuTrigger = Trigger;

export function DropdownMenuContent({
  align = "end",
  className = "",
  sideOffset = 6,
  ...props
}: ComponentProps<typeof Content>) {
  return (
    <Portal>
      <Content
        align={align}
        className={`menu-content ${className}`}
        sideOffset={sideOffset}
        {...props}
      />
    </Portal>
  );
}

export function DropdownMenuItem({
  className = "",
  destructive = false,
  ...props
}: ComponentProps<typeof Item> & { destructive?: boolean }) {
  return (
    <Item
      className={`menu-item ${destructive ? "destructive-item" : ""} ${className}`}
      {...props}
    />
  );
}

export function DropdownMenuRadioGroup(
  props: ComponentProps<typeof RadioGroup>
) {
  return <RadioGroup {...props} />;
}

export function DropdownMenuRadioItem({
  children,
  className = "",
  ...props
}: ComponentProps<typeof RadioItem>) {
  return (
    <RadioItem className={`menu-item radio-item ${className}`} {...props}>
      <ItemIndicator className="menu-indicator">
        <CheckIcon />
      </ItemIndicator>
      {children}
    </RadioItem>
  );
}

export function DropdownMenuLabel(props: ComponentProps<typeof Label>) {
  return <Label className="menu-label" {...props} />;
}

export function DropdownMenuSeparator(props: ComponentProps<typeof Separator>) {
  return <Separator className="menu-separator" {...props} />;
}
