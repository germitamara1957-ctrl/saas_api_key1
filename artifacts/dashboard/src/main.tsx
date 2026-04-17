import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { ThemeProvider } from "@/lib/theme";

setAuthTokenGetter(() => localStorage.getItem("auth_token"));

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>
);
