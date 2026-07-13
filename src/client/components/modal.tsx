import type { ReactNode } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";

export function Modal({
  children,
  onClose,
  open,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  open: boolean;
  title: string;
}) {
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-xl overflow-auto"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
