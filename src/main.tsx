import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import "./styles.css";
import App from "./App";
import { initTheme } from "./theme";

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Toaster richColors position="bottom-right" />
    <App />
  </StrictMode>,
);
