import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { installClientErrorReporting } from "@/lib/client-error-reporting";
import "./index.css";

installClientErrorReporting();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
