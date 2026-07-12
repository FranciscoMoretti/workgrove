import { GripVerticalIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

export function ResizablePanelGroup({
  className = "",
  ...props
}: ComponentProps<typeof PanelGroup>) {
  return <PanelGroup className={`resizable-group ${className}`} {...props} />;
}

export const ResizablePanel = Panel;

export function ResizableHandle({
  className = "",
  withHandle = false,
  ...props
}: ComponentProps<typeof PanelResizeHandle> & { withHandle?: boolean }) {
  return (
    <PanelResizeHandle className={`resize-handle ${className}`} {...props}>
      {withHandle ? <GripVerticalIcon /> : null}
    </PanelResizeHandle>
  );
}
