import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";
import { ForgeProvider } from "./state";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ForgeProvider><App /></ForgeProvider>
  </React.StrictMode>,
);
