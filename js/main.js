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
