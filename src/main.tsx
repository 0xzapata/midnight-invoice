import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { OperatorEntry, isOperatorPath } from "./operator/OperatorEntry";
import "./index.css";

// The private operator console (/operator) is a separate, lazily loaded bundle.
createRoot(document.getElementById("root")!).render(isOperatorPath(window.location.pathname) ? <OperatorEntry /> : <App />);
