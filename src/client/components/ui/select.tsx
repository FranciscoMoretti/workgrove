import {
  Content,
  Icon,
  Item,
  ItemIndicator,
  ItemText,
  Portal,
  Root,
  ScrollDownButton,
  ScrollUpButton,
  Trigger,
  Value,
  Viewport,
} from "@radix-ui/react-select";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import type { ComponentProps } from "react";

export const Select = Root;
export const SelectValue = Value;

export function SelectTrigger({
  children,
  className = "",
  ...props
}: ComponentProps<typeof Trigger>) {
  return (
    <Trigger className={`select-trigger ${className}`} {...props}>
      {children}
      <Icon className="select-trigger-icon">
        <ChevronDownIcon />
      </Icon>
    </Trigger>
  );
}

export function SelectContent({
  children,
  className = "",
  position = "popper",
  sideOffset = 6,
  ...props
}: ComponentProps<typeof Content>) {
  return (
    <Portal>
      <Content
        className={`select-content ${className}`}
        position={position}
        sideOffset={sideOffset}
        {...props}
      >
        <ScrollUpButton className="select-scroll-button">
          <ChevronUpIcon />
        </ScrollUpButton>
        <Viewport className="select-viewport">{children}</Viewport>
        <ScrollDownButton className="select-scroll-button">
          <ChevronDownIcon />
        </ScrollDownButton>
      </Content>
    </Portal>
  );
}

export function SelectItem({
  children,
  className = "",
  ...props
}: ComponentProps<typeof Item>) {
  return (
    <Item className={`select-item ${className}`} {...props}>
      <ItemText>{children}</ItemText>
      <ItemIndicator className="select-item-indicator">
        <CheckIcon />
      </ItemIndicator>
    </Item>
  );
}
