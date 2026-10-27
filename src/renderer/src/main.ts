import { mount } from "svelte";
import { externalUrl } from "../../shared/links";
import App from "./App.svelte";
import { trackRuns } from "./lib/runs";
import "./app.css";

// Before anything can run: run events must reach the store whichever notebook is shown.
trackRuns();

// Links never navigate the app window. http(s) links open in the system browser via
// the main process's window-open handler; every other link does nothing.
document.addEventListener("click", (event) => {
  const link = event.target instanceof Element ? event.target.closest("a") : null;
  if (!link) return;
  event.preventDefault();
  const url = externalUrl(link.getAttribute("href"));
  if (url) window.open(url);
});

const target = document.getElementById("app");
if (!target) throw new Error("Missing #app element");

export default mount(App, { target });
