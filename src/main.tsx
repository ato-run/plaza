/**
 * Standalone Plaza entry — the whole application on its own origin.
 *
 * Deliberately NOT the PWA: no `App`, no router, no AccountShell, no service
 * worker, no library seed, no analytics bootstrap. Plaza is one screen
 * that authenticates against its own origin, and mounting the PWA shell here
 * would put the home screen and account chrome on a host that exists
 * precisely to not have them.
 *
 * Styles are `styles/base.css` (document frame) plus the self-contained
 * `playground/playground.css` (every rule scoped to `.pg-*`). The PWA's
 * `globals.css` token layer is deliberately NOT imported: the HUD palette is
 * tuned for the 3D sky, not for a white document.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles/base.css";
import PlaygroundPage from "./playground/PlaygroundPage";

const container = document.getElementById("playground-root");
if (container) {
  createRoot(container).render(
    <StrictMode>
      <PlaygroundPage />
    </StrictMode>,
  );
}
