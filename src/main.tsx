import process from "process";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "~/app";

if (typeof window !== "undefined") {
  (window as unknown as { process: typeof process }).process =
    process;

  process.nextTick = (cb: () => void) => Promise.resolve().then(cb);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
