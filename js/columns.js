import {
  mainEl,
  createNewColumn as createColumn,
  renderColumn,
  attachAutosaveHandlers,
} from "./supabase-doc.js";

export function mountAddColumnTile() {
  const m = mainEl();

  const tile = document.createElement("section");
  tile.className = "column add-column";
  tile.contentEditable = "false";

  tile.innerHTML = `<h2 class="Add-Column">Add New Column...</h2>`;
  const trigger = tile.querySelector(".Add-Column");

  async function addColumn() {
    trigger.style.pointerEvents = "none";

    const row = await createColumn();
    if (!row) {
      trigger.style.pointerEvents = "";
      return;
    }

    const el = renderColumn(row);
    el.dataset.new = "true";
    m.insertBefore(el, tile);

    // Attach lock + autosave behavior
    attachAutosaveHandlers([el]);

    // Immediately attempt to lock it (so it becomes editable)
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

    trigger.style.pointerEvents = "";
  }

  trigger.addEventListener("click", addColumn);

  trigger.tabIndex = 0;
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addColumn();
    }
  });

  m.appendChild(tile);
}
