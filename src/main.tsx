import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import "./styles.css";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import { markLoadedCleanly } from "./lib/lazy";
import { initTheme } from "./theme";
import { startTracking } from "./lib/track";

initTheme();
markLoadedCleanly();
startTracking();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Toaster richColors position="bottom-right" />
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
