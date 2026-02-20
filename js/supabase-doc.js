// js/supabase-doc.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* Supabase */
const SUPABASE_URL = "https://tmiiwidxtdjhklgfgqbr.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRtaWl3aWR4dGRqaGtsZ2ZncWJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5MDMwMzAsImV4cCI6MjA4NjQ3OTAzMH0.QHjeuWBwuP1q6tAofQC5ITDacln6q8LA5qZPmqmyguI";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* Client identity (per browser) */
const CLIENT_ID_KEY = "tmorrow_client_id";
export const CLIENT_ID =
  localStorage.getItem(CLIENT_ID_KEY) ||
  (() => {
    const id = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
    return id;
  })();

/* Lock + polling */
const LOCK_TTL_SECONDS = 60;
const LOCK_REFRESH_MS = 20000;
const POLL_ACTIVE_MS = 3000;
const POLL_IDLE_MS = 15000;

/* Images */
const IMAGE_BUCKET = "Images";
const IMAGE_MAX_EDGE = 300;
const IMAGE_JPEG_QUALITY = 0.65;

/* Single-active column per client */
let ACTIVE_COL_ID = null;
let ACTIVE_EL = null;

/* Internal registries */
const COLS_BY_ID = new Map(); // id -> <section.column>
const saveTimers = new Map(); // el -> timeout
let POLL_STARTED = false;
let UNLOAD_HOOKED = false;

/* DOM */
export function mainEl() {
  return document.querySelector(".main-content");
}
function getBody(el) {
  return el.querySelector(".col-body");
}
function placeCaretAtEnd(el) {
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

/* Lock helpers */
function lockIsExpired(locked_at) {
  if (!locked_at) return true;
  return Date.now() - new Date(locked_at).getTime() > LOCK_TTL_SECONDS * 1000;
}

/* Sanitize saved HTML (remove UI artifacts only) */
function sanitizeHtml(html) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html || "";
  wrapper.querySelectorAll(".lock-note").forEach((n) => n.remove());
  wrapper.querySelectorAll("*").forEach((el) => {
    if (
      (el.textContent || "").trim() === "Someone else is editing this column"
    ) {
      el.remove();
    }
  });
  return wrapper.innerHTML;
}

/* Keep top-level text wrapped in <p> and avoid stray text nodes */
function normalizeParagraphs(body) {
  // Remove top-level whitespace-only text nodes
  Array.from(body.childNodes).forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE && (n.textContent || "").trim() === "")
      n.remove();
  });

  // Wrap remaining top-level text nodes into <p>
  let node = body.firstChild;
  while (node) {
    const next = node.nextSibling;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      if (text.trim() === "") {
        node.remove();
      } else {
        const p = document.createElement("p");
        p.appendChild(node); // move text node into <p>
        body.insertBefore(p, next);
      }
    }
    node = next;
  }
}

/* Image processing + upload */
function buildImageStoragePath(colId) {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const date = `${yyyy}-${mm}-${dd}`;
  const uuid = crypto.randomUUID();
  return `${colId}/${date}/${uuid}.jpg`;
}

async function processImageToGrayscaleJpeg(
  file,
  maxEdge = IMAGE_MAX_EDGE,
  quality = IMAGE_JPEG_QUALITY
) {
  const bmp = await createImageBitmap(file);

  const w = bmp.width;
  const h = bmp.height;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, outW, outH);

  const imgData = ctx.getImageData(0, 0, outW, outH);
  const d = imgData.data;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    d[i] = y;
    d[i + 1] = y;
    d[i + 2] = y;
  }

  ctx.putImageData(imgData, 0, 0);

  const blob = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
  });

  return blob || null;
}

async function uploadImageBlob(blob, colId) {
  const path = buildImageStoragePath(colId);

  const { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, blob, {
      upsert: false,
      contentType: "image/jpeg",
      cacheControl: "3600",
    });

  if (error) {
    console.error("Image upload error:", error);
    return null;
  }

  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return { publicUrl: data?.publicUrl || null, path };
}

function insertImageAtCursor(url, imgId, storagePath) {
  const safeUrl = String(url).replace(/"/g, "&quot;");
  const safeId = String(imgId).replace(/"/g, "&quot;");
  const safePath = String(storagePath || "").replace(/"/g, "&quot;");

  const html =
    `<p>` +
    `<img class="col-img" data-img-id="${safeId}" data-img-path="${safePath}" src="${safeUrl}" alt="">` +
    `</p>`;

  document.execCommand("insertHTML", false, html);
}

/* Columns: render + load */
export function renderColumn(row) {
  const s = document.createElement("section");
  s.className = "column";
  s.id = row.id;
  s.dataset.colId = String(row.id);

  const note = document.createElement("div");
  note.className = "lock-note";
  note.textContent = "Someone else is editing this column";

  const body = document.createElement("div");
  body.className = "col-body";
  body.innerHTML = sanitizeHtml(row.html || "");
  body.contentEditable = "false";

  s.appendChild(note);
  s.appendChild(body);

  const hasOwner = !!row.locked_by && !lockIsExpired(row.locked_at);
  const blocked = hasOwner && row.locked_by !== CLIENT_ID;
  s.dataset.blocked = blocked ? "true" : "false";
  s.title = blocked ? "Someone else is editing" : "Click to edit";

  return s;
}

export async function loadAndRenderColumns() {
  const { data, error } = await supabase
    .from("columns")
    .select("id, html, locked_by, locked_at, position")
    .order("position", { ascending: true });

  if (error) {
    console.error("Load error:", error);
    return [];
  }

  const m = mainEl();
  m.innerHTML = "";
  const els = (data || []).map(renderColumn);
  els.forEach((el) => m.appendChild(el));
  return els;
}

/* RPC locks */
export async function acquireLock(id) {
  const { data, error } = await supabase.rpc("acquire_column_lock", {
    p_id: id,
    p_client_id: CLIENT_ID,
    p_ttl_seconds: LOCK_TTL_SECONDS,
  });

  if (error) return { ok: false, error };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row)
    return { ok: false, error: { message: "No row from acquire_column_lock" } };
  return { ok: true, row };
}

export async function releaseLock(id) {
  const { data, error } = await supabase.rpc("release_column_lock", {
    p_id: id,
    p_client_id: CLIENT_ID,
  });
  if (error) return { ok: false, error };
  return { ok: true, released: data === true };
}

export async function refreshLock(id) {
  return acquireLock(id);
}

/* Save (only if lock owned) */
export async function saveColumnEl(el) {
  const id = el.dataset.colId;
  const body = getBody(el);
  if (!body) return false;

  const html = body.innerHTML;

  const { data, error } = await supabase
    .from("columns")
    .update({ html })
    .eq("id", id)
    .eq("locked_by", CLIENT_ID)
    .select("id");

  if (error) {
    console.error("Save error:", error);
    return false;
  }

  if (!data || data.length === 0) {
    body.contentEditable = "false";
    el.dataset.blocked = "true";
    el.title = "Someone else is editing";
    if (ACTIVE_COL_ID === id) {
      ACTIVE_COL_ID = null;
      ACTIVE_EL = null;
    }
    return false;
  }

  return true;
}

export function scheduleSave(el, delayMs = 300) {
  clearTimeout(saveTimers.get(el));
  saveTimers.set(
    el,
    setTimeout(() => saveColumnEl(el), delayMs)
  );
}

/* Create column (race-proof via RPC) */
export async function createNewColumn() {
  const { data, error } = await supabase.rpc("create_next_column");
  if (error) {
    console.error("Create column error:", error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.id) {
    console.error("Create column returned unexpected data:", data);
    return null;
  }
  return row;
}

/* Attach editor behavior */
export function attachAutosaveHandlers(columnEls) {
  // Bind once per element
  columnEls.forEach((el) => {
    const id = String(el?.dataset?.colId || "");
    if (!id) return;
    if (COLS_BY_ID.has(id)) return;

    COLS_BY_ID.set(id, el);

    const body = getBody(el);
    if (!body) return;

    let locking = false;
    let haveLock = false;

    let keepAliveTimer = null;
    let inactivityTimer = null;

    function setViewerState(blocked) {
      haveLock = false;
      body.contentEditable = "false";
      el.dataset.blocked = blocked ? "true" : "false";
      el.title = blocked ? "Someone else is editing" : "Click to edit";
    }

    function startKeepAlive() {
      clearInterval(keepAliveTimer);
      keepAliveTimer = setInterval(() => {
        if (haveLock && ACTIVE_COL_ID === id) refreshLock(id);
      }, LOCK_REFRESH_MS);
    }

    async function releaseCurrent() {
      if (!ACTIVE_EL || !ACTIVE_COL_ID) return;

      const prevEl = ACTIVE_EL;
      const prevId = ACTIVE_COL_ID;
      const prevBody = getBody(prevEl);

      await saveColumnEl(prevEl);
      await releaseLock(prevId);

      if (prevBody) prevBody.contentEditable = "false";
      prevEl.dataset.blocked = "false";
      prevEl.title = "Click to edit";

      ACTIVE_COL_ID = null;
      ACTIVE_EL = null;
    }

    async function releaseDueToInactivity() {
      if (!haveLock || ACTIVE_COL_ID !== id) return;
      await releaseCurrent();
      haveLock = false;
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
      setViewerState(false);
    }

    function resetInactivity() {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(
        releaseDueToInactivity,
        LOCK_TTL_SECONDS * 1000
      );
    }

    async function attemptLock() {
      if (locking) return;
      locking = true;

      try {
        if (ACTIVE_COL_ID === id && haveLock) {
          resetInactivity();
          return;
        }

        if (ACTIVE_COL_ID && ACTIVE_COL_ID !== id) {
          await releaseCurrent();
        }

        el.dataset.blocked = "false";
        el.title = "Locking…";

        const res = await acquireLock(id);
        if (!res.ok) {
          console.error("Lock error:", res.error);
          setViewerState(false);
          el.title = "Lock error, click to retry";
          return;
        }

        const owner = res.row.out_locked_by;
        if (owner !== CLIENT_ID) {
          setViewerState(true);
          return;
        }

        ACTIVE_COL_ID = id;
        ACTIVE_EL = el;
        haveLock = true;

        body.contentEditable = "true";
        el.dataset.blocked = "false";
        el.title = "";

        startKeepAlive();
        resetInactivity();

        setTimeout(() => {
          if (el.dataset.new === "true") {
            placeCaretAtEnd(body);
            delete el.dataset.new;
          } else {
            body.focus();
          }
        }, 0);
      } finally {
        locking = false;
      }
    }

    setViewerState(el.dataset.blocked === "true");
    el.addEventListener("click", () => attemptLock());

    const onEdit = () => {
      if (!haveLock || ACTIVE_COL_ID !== id) return;
      normalizeParagraphs(body);
      scheduleSave(el, 250);
      resetInactivity();
    };

    body.addEventListener("input", onEdit);

    // Paste images only (text paste falls through)
    body.addEventListener("paste", async (e) => {
      if (!haveLock || ACTIVE_COL_ID !== id) return;

      const items = e.clipboardData?.items
        ? Array.from(e.clipboardData.items)
        : [];
      const imgItem = items.find(
        (it) => it.type && it.type.startsWith("image/")
      );
      if (!imgItem) return;

      e.preventDefault();

      const file = imgItem.getAsFile();
      if (!file) return;

      let processed = null;
      try {
        processed = await processImageToGrayscaleJpeg(file);
      } catch (err) {
        console.error("Image processing error:", err);
        return;
      }
      if (!processed) return;

      const uploaded = await uploadImageBlob(processed, id);
      if (!uploaded?.publicUrl) return;

      insertImageAtCursor(
        uploaded.publicUrl,
        crypto.randomUUID(),
        uploaded.path
      );
      onEdit();
    });

    // Drag & drop images
    body.addEventListener("dragover", (e) => {
      if (!haveLock || ACTIVE_COL_ID !== id) return;
      const dt = e.dataTransfer;
      if (dt?.files?.length > 0) {
        e.preventDefault();
        dt.dropEffect = "copy";
      }
    });

    body.addEventListener("drop", async (e) => {
      if (!haveLock || ACTIVE_COL_ID !== id) return;

      const dt = e.dataTransfer;
      const files = dt?.files ? Array.from(dt.files) : [];
      const imageFiles = files.filter(
        (f) => f.type && f.type.startsWith("image/")
      );
      if (imageFiles.length === 0) return;

      e.preventDefault();
      e.stopPropagation();

      for (const file of imageFiles) {
        let processed = null;
        try {
          processed = await processImageToGrayscaleJpeg(file);
        } catch (err) {
          console.error("Image processing error:", err);
          continue;
        }
        if (!processed) continue;

        const uploaded = await uploadImageBlob(processed, id);
        if (!uploaded?.publicUrl) continue;

        insertImageAtCursor(
          uploaded.publicUrl,
          crypto.randomUUID(),
          uploaded.path
        );
      }

      onEdit();
    });

    // Keyboard shortcuts
    body.addEventListener("keydown", (e) => {
      if (!haveLock || ACTIVE_COL_ID !== id) return;

      const isMac = navigator.platform.toLowerCase().includes("mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;

      // Italic
      if (mod && e.key.toLowerCase() === "i") {
        e.preventDefault();
        document.execCommand("italic", false, null);
        onEdit();
        return;
      }

      // Underline
      if (mod && e.key.toLowerCase() === "u") {
        e.preventDefault();
        document.execCommand("underline", false, null);
        onEdit();
        return;
      }

      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        document.execCommand("strikeThrough", false, null);
        onEdit();
        return;
      }

      // Undo / Redo
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) document.execCommand("redo", false, null);
        else document.execCommand("undo", false, null);
        onEdit();
        return;
      }

      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        document.execCommand("redo", false, null);
        onEdit();
        return;
      }

      // Enter -> single <br>
      if (e.key === "Enter") {
        e.preventDefault();
        document.execCommand("insertHTML", false, "<br>");
        onEdit();
        return;
      }
    });
  });

  // Poll (metadata first, html only if updated_at changed)
  if (!POLL_STARTED) {
    POLL_STARTED = true;

    const lastUpdated = new Map(); // id -> updated_at string

    async function pollLoop() {
      try {
        const { data: meta, error: metaErr } = await supabase
          .from("columns")
          .select("id, updated_at, locked_by, locked_at");

        if (metaErr || !meta) return;

        const changedIds = [];

        for (const row of meta) {
          const id = String(row.id);

          if (ACTIVE_COL_ID === id) continue;

          const el = COLS_BY_ID.get(id);
          if (el) {
            const hasOwner = !!row.locked_by && !lockIsExpired(row.locked_at);
            const isMine = row.locked_by === CLIENT_ID;
            const blocked = hasOwner && !isMine;
            el.dataset.blocked = blocked ? "true" : "false";
            el.title = blocked ? "Someone else is editing" : "Click to edit";
          }

          const now = row.updated_at ? String(row.updated_at) : "";
          if (lastUpdated.get(id) !== now) {
            lastUpdated.set(id, now);
            changedIds.push(id);
          }
        }

        if (changedIds.length > 0) {
          const CHUNK = 25;

          for (let i = 0; i < changedIds.length; i += CHUNK) {
            const ids = changedIds.slice(i, i + CHUNK);

            const { data: rows, error: htmlErr } = await supabase
              .from("columns")
              .select("id, html")
              .in("id", ids);

            if (htmlErr || !rows) continue;

            for (const r of rows) {
              const id = String(r.id);
              if (ACTIVE_COL_ID === id) continue;

              const el = COLS_BY_ID.get(id);
              const body = el ? getBody(el) : null;
              if (!body) continue;

              const incoming = sanitizeHtml(r.html || "");
              if (body.innerHTML !== incoming) body.innerHTML = incoming;

              body.contentEditable = "false";
            }
          }
        }
      } finally {
        const delay = ACTIVE_COL_ID ? POLL_ACTIVE_MS : POLL_IDLE_MS;
        setTimeout(pollLoop, delay);
      }
    }

    pollLoop();
  }

  // Release lock on unload (best effort)
  if (!UNLOAD_HOOKED) {
    UNLOAD_HOOKED = true;
    window.addEventListener("beforeunload", () => {
      if (ACTIVE_COL_ID) releaseLock(ACTIVE_COL_ID);
    });
  }
}
