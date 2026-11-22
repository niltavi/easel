import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {registerSW} from "virtual:pwa-register";
import {Root} from "./site/Root.tsx";

registerSW({immediate: true});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
