import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./playground.css";

const root = document.getElementById("root");
if (!root) throw new Error("playground: #root missing");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
