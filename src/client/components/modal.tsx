import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "./ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "./ui/dialog";

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
      <DialogContent aria-describedby={undefined}>
        <div className="modal-heading">
          <DialogTitle>{title}</DialogTitle>
          <DialogClose asChild>
            <Button aria-label="Close dialog" size="icon" variant="ghost">
              <XIcon />
            </Button>
          </DialogClose>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}
