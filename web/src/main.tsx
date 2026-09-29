import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";

try {
  const saved = localStorage.getItem("hzmap-theme");
  if (saved === "dark") document.documentElement.classList.add("dark");
} catch {
  // Storage can be blocked. Light stays the default.
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
