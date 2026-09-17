import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// Flips the deferred Google Fonts stylesheet (media="print" in index.html)
// to active once it's loaded, without an inline onload= attribute — that
// approach is blocked by CSP script-src 'self'.
const fontLink = document.getElementById("google-fonts-stylesheet") as HTMLLinkElement | null;
fontLink?.addEventListener("load", () => {
  fontLink.media = "all";
});

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
