// js/main.js
import {
  loadAndRenderColumns,
  attachAutosaveHandlers,
} from "./supabase-doc.js";
import { mountAddColumnTile } from "./columns.js";

await new Promise((resolve) =>
  window.addEventListener("load", resolve, { once: true })
);
// optional: also wait for fonts
if (document.fonts?.ready) await document.fonts.ready;

const cols = await loadAndRenderColumns();
attachAutosaveHandlers(cols);
mountAddColumnTile();
