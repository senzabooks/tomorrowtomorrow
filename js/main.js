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

function bindAppHeightToVisualViewport() {
  const vv = window.visualViewport;
  const set = () => {
    const h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty("--app-height", `${h}px`);
  };
  set();
  vv?.addEventListener("resize", set);
  vv?.addEventListener("scroll", set);
  window.addEventListener("orientationchange", set);
}

bindAppHeightToVisualViewport();
