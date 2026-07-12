import {
  Close,
  Content,
  Description,
  Overlay,
  Portal,
  Root,
  Title,
} from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";

export const Dialog = Root;
export const DialogClose = Close;
export const DialogTitle = Title;
export const DialogDescription = Description;

export function DialogContent({
  className = "",
  ...props
}: ComponentProps<typeof Content>) {
  return (
    <Portal>
      <Overlay className="dialog-overlay" />
      <Content className={`modal ${className}`} {...props} />
    </Portal>
  );
}
