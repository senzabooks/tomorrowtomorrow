const ENDPOINT =
  "https://tmiiwidxtdjhklgfgqbr.functions.supabase.co/public-columns";

function mainEl() {
  return document.querySelector(".main-content");
}

function renderColumn(row) {
  const s = document.createElement("section");
  s.className = "column";
  s.id = row.id;

  const body = document.createElement("div");
  body.className = "col-body";
  body.innerHTML = row.html || "";

  s.appendChild(body);
  return s;
}

async function loadOnce() {
  const res = await fetch(ENDPOINT);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const json = await res.json();

  const m = mainEl();
  m.innerHTML = "";

  (json.columns || []).forEach((row) => m.appendChild(renderColumn(row)));
}

await loadOnce();
