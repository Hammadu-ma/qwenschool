import React from "react";
import ReactDOM from "react-dom/client";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import "./index.css";
import App from "./App.tsx";
import { queryClient, persister } from "./lib/queryClient";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: Infinity }}>
    <App />
  </PersistQueryClientProvider>
);
