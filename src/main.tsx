import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./style.css";
import { initializeLanguage } from "./i18n";
import { applyTheme, readTheme } from "./theme";
applyTheme(readTheme());
initializeLanguage();
createRoot(document.getElementById("root")!).render(<App />);
