import {
  loadAndRenderColumns,
  attachAutosaveHandlers,
} from "./supabase-doc.js";
import { mountAddColumnTile } from "./columns.js";

console.log("main.js running");

const cols = await loadAndRenderColumns();
console.log("loaded columns:", cols.length);

attachAutosaveHandlers(cols);
mountAddColumnTile();

function bindKbd() {
  const vv = window.visualViewport;
  if (!vv) return;
  const set = () =>
    document.documentElement.style.setProperty(
      "--kbd",
      `${Math.max(
        0,
        Math.round(window.innerHeight - vv.height - vv.offsetTop)
      )}px`
    );
  set();
  vv.addEventListener("resize", set);
  vv.addEventListener("scroll", set);
}
bindKbd();
