import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {registerSW} from "virtual:pwa-register";
import "@fontsource-variable/dm-sans";
import "./index.css";
import {App} from "./components/App.tsx";

registerSW({immediate: true});

// A two-finger trackpad pinch arrives in the browser as Ctrl+wheel. The canvas handles zoom itself;
// intercept it when the pointer is over the toolbar or sidebar, so the whole page doesn't get zoomed.
window.addEventListener(
  "wheel",
  (event) => {
    if (event.ctrlKey && !(event.target as Element | null)?.closest?.(".excalidraw")) event.preventDefault();
  },
  {passive: false},
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
