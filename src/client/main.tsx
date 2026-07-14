import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { RecoveryBoundary } from "./components/recovery-boundary";
import { TooltipProvider } from "./components/ui/tooltip";
import { queryClient } from "./query-client";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing root element");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RecoveryBoundary
          description="Workgrove caught an unexpected interface error before it could blank the entire dashboard."
          title="Workgrove needs to recover"
        >
          <App />
        </RecoveryBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>
);
