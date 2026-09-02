import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { parseBlocks, parseInline, applyMarker, noteSummary } from "../lib/noteFormat";
import { compressImage, readableSize } from "../lib/imageCompress";

const NOTE_COLORS = [
  { id: "butter", label: "Butter", bg: "#fdf3d0", edge: "#e8d79a" },
  { id: "rose",   label: "Rose",   bg: "#fbe0e0", edge: "#eec2c2" },
  { id: "sage",   label: "Sage",   bg: "#e2ecdf", edge: "#c3d6bd" },
  { id: "sky",    label: "Sky",    bg: "#dee9f2", edge: "#bed3e4" },
  { id: "lilac",  label: "Lilac",  bg: "#e8e2f2", edge: "#cdc2e4" },
  { id: "sand",   label: "Sand",   bg: "#eee7dc", edge: "#d8cab4" },
];
const colorOf = (id) => NOTE_COLORS.find(c => c.id === id) || NOTE_COLORS[0];

const EMPTY_NOTE = { id: null, title: "", body: "", color: "butter", pinned: false, taskId: null, recipeId: null, image: null };

/** "just now", "3h ago", then a date once it stops being useful as elapsed time. */
export function relativeTime(iso, now = Date.now()) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.round((now - then) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Inline tokens as React elements — no HTML string is ever constructed. */
function Inline({ text }) {
  return (
    <>
      {parseInline(text).map((token, i) => {
        switch (token.type) {
          case "bold":   return <strong key={i}>{token.value}</strong>;
          case "italic": return <em key={i}>{token.value}</em>;
          case "strike": return <s key={i}>{token.value}</s>;
          case "code":   return <code key={i} className="note-code">{token.value}</code>;
          case "link":
            return (
              <a key={i} href={token.href} target="_blank" rel="noreferrer noopener"
                 onClick={e => e.stopPropagation()}>
                {token.value}
              </a>
            );
          default: return <span key={i}>{token.value}</span>;
        }
      })}
    </>
  );
}

export function NoteBody({ text }) {
  const blocks = parseBlocks(text);
  if (!blocks.length) return null;
  return (
    <div className="note-body">
      {blocks.map((block, i) => {
        if (block.type === "ul" || block.type === "ol") {
          const List = block.type === "ul" ? "ul" : "ol";
          return (
            <List key={i}>
              {block.items.map((item, j) => <li key={j}><Inline text={item} /></li>)}
            </List>
          );
        }
        return (
          <p key={i}>
            {block.lines.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                <Inline text={line} />
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

export default function Corkboard({
  notes = [], setNotes, tasks = { items: [] }, recipes = [], users = [], currentUser,
  apiEnabled, queueMutation, showToast, onNavigate,
}) {
  const [editing, setEditing] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef(null);
  const fileRef = useRef(null);

  const taskItems = tasks?.items || [];
  const userName = (id) => users.find(u => String(u.id) === String(id))?.username || null;

  const ordered = useMemo(() => {
    // Pinned first, then most recently touched.
    return [...notes].sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
    });
  }, [notes]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (deleteId) { setDeleteId(null); return; }
      if (editing) setEditing(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editing, deleteId]);

  const openNew = () => setEditing({ ...EMPTY_NOTE, _photo: null });
  const openEdit = (note) => setEditing({ ...note, _photo: null, _removeImage: false });

  const format = (marker) => {
    const el = bodyRef.current;
    if (!el) return;
    const { text, selectionStart, selectionEnd } = applyMarker(el.value, el.selectionStart, el.selectionEnd, marker);
    setEditing(p => ({ ...p, body: text }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selectionStart, selectionEnd);
    });
  };

  const choosePhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const before = file.size;
    const compressed = await compressImage(file);
    setEditing(p => ({ ...p, _photo: compressed, _removeImage: false }));
    if (compressed.size < before) {
      showToast?.(`Photo shrunk ${readableSize(before)} → ${readableSize(compressed.size)}`);
    }
  };

  const save = async () => {
    const draft = editing;
    if (!draft.title.trim() && !draft.body.trim() && !draft._photo && !draft.image) {
      showToast?.("Add a title, some text, or a photo", "danger");
      return;
    }
    setBusy(true);
    const fields = {
      title: draft.title.trim(),
      body: draft.body,
      color: draft.color,
      pinned: Boolean(draft.pinned),
      taskId: draft.taskId ?? null,
      recipeId: draft.recipeId ?? null,
      ...(draft._removeImage ? { removeImage: "true" } : {}),
    };

    try {
      if (!apiEnabled) {
        // Offline: photos need a real upload, so only text is queued.
        const now = new Date().toISOString();
        const local = draft.id
          ? { ...draft, ...fields, updatedAt: now }
          : { ...fields, id: Date.now(), image: null, authorId: currentUser?.id || null, authorName: currentUser?.username || null, createdAt: now, updatedAt: now };
        setNotes(prev => draft.id ? prev.map(n => n.id === draft.id ? local : n) : [...prev, local]);
        queueMutation?.({
          method: draft.id ? "PUT" : "POST",
          endpoint: draft.id ? `/api/notes/${draft.id}` : "/api/notes",
          body: fields, resource: "notes", tempId: local.id,
        });
        if (draft._photo) showToast?.("Photo will need re-adding once you are back online", "danger");
        setEditing(null);
        return;
      }

      let body, headers;
      if (draft._photo) {
        body = new FormData();
        body.append("data", JSON.stringify(fields));
        body.append("image", draft._photo);
      } else {
        body = JSON.stringify(fields);
        headers = { "Content-Type": "application/json" };
      }
      const saved = await apiFetch(draft.id ? `/api/notes/${draft.id}` : "/api/notes", {
        method: draft.id ? "PUT" : "POST", body, headers,
      });
      if (saved) {
        setNotes(prev => draft.id ? prev.map(n => n.id === saved.id ? saved : n) : [...prev, saved]);
        setEditing(null);
      }
    } catch (err) {
      showToast?.(err.message || "Could not save that note", "danger");
    } finally {
      setBusy(false);
    }
  };

  const togglePin = async (note) => {
    const pinned = !note.pinned;
    setNotes(prev => prev.map(n => n.id === note.id ? { ...n, pinned } : n));
    if (!apiEnabled) {
      queueMutation?.({ method: "PUT", endpoint: `/api/notes/${note.id}`, body: { pinned }, resource: "notes", tempId: note.id });
      return;
    }
    try {
      await apiFetch(`/api/notes/${note.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned }),
      });
    } catch {
      setNotes(prev => prev.map(n => n.id === note.id ? note : n));
    }
  };

  const confirmDelete = async () => {
    const id = deleteId;
    const previous = notes;
    setNotes(prev => prev.filter(n => n.id !== id));
    setDeleteId(null);
    if (!apiEnabled) {
      queueMutation?.({ method: "DELETE", endpoint: `/api/notes/${id}`, resource: "notes", tempId: id });
      return;
    }
    try {
      await apiFetch(`/api/notes/${id}`, { method: "DELETE" });
      showToast?.("Note removed", "danger");
    } catch {
      setNotes(previous);
      showToast?.("Could not remove that note", "danger");
    }
  };

  const linkedTask = (id) => taskItems.find(t => String(t.id) === String(id)) || null;
  const linkedRecipe = (id) => recipes.find(r => String(r.id) === String(id)) || null;

  return (
    <section className="corkboard">
      <div className="corkboard-head">
        <h2>Notes</h2>
        <button className="corkboard-add" onClick={openNew}>
          <span aria-hidden="true">+</span> New note
        </button>
      </div>

      {ordered.length === 0 ? (
        <p className="corkboard-empty">Nothing pinned yet. Leave a note for the household.</p>
      ) : (
        <div className="corkboard-grid">
          {ordered.map(note => {
            const tone = colorOf(note.color);
            const task = linkedTask(note.taskId);
            const recipe = linkedRecipe(note.recipeId);
            const author = note.authorName || userName(note.authorId) || "Someone";
            return (
              <article
                key={note.id}
                className={`note${note.pinned ? " is-pinned" : ""}`}
                style={{ background: tone.bg, borderColor: tone.edge }}
                onClick={() => openEdit(note)}
              >
                <header className="note-head">
                  <span className="note-author">{author}</span>
                  <span className="note-time" title={note.createdAt}>
                    {relativeTime(note.updatedAt || note.createdAt)}
                    {note.updatedAt && note.createdAt && note.updatedAt !== note.createdAt ? " · edited" : ""}
                  </span>
                  <button
                    className={`note-pin${note.pinned ? " is-on" : ""}`}
                    aria-label={note.pinned ? `Unpin ${note.title || "note"}` : `Pin ${note.title || "note"}`}
                    aria-pressed={Boolean(note.pinned)}
                    onClick={e => { e.stopPropagation(); togglePin(note); }}
                  >
                    ⌜
                  </button>
                </header>

                {note.title && <h3 className="note-title">{note.title}</h3>}
                {note.image && <img className="note-photo" src={note.image} alt="" loading="lazy" />}
                <NoteBody text={note.body} />

                {(task || recipe) && (
                  <div className="note-links">
                    {task && (
                      <button onClick={e => { e.stopPropagation(); onNavigate?.("tasks"); }}>
                        ✓ {task.title}
                      </button>
                    )}
                    {recipe && (
                      <button onClick={e => { e.stopPropagation(); onNavigate?.("meal"); }}>
                        ❧ {recipe.name}
                      </button>
                    )}
                  </div>
                )}

                <button
                  className="note-remove"
                  aria-label={`Delete ${note.title || noteSummary(note.body) || "note"}`}
                  onClick={e => { e.stopPropagation(); setDeleteId(note.id); }}
                >
                  ×
                </button>
              </article>
            );
          })}
        </div>
      )}

      {editing && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setEditing(null)}>
          <div className="modal-box note-editor" style={{ maxWidth: 560, width: "100%" }}>
            <h3>{editing.id ? "Edit note" : "New note"}</h3>

            <input
              className="note-input"
              placeholder="Title (optional)"
              aria-label="Note title"
              value={editing.title}
              onChange={e => setEditing(p => ({ ...p, title: e.target.value }))}
            />

            <div className="note-toolbar" role="group" aria-label="Formatting">
              <button type="button" onClick={() => format("**")} title="Bold"><strong>B</strong></button>
              <button type="button" onClick={() => format("*")} title="Italic"><em>I</em></button>
              <button type="button" onClick={() => format("~~")} title="Strikethrough"><s>S</s></button>
              <button type="button" onClick={() => format("`")} title="Code">{"<>"}</button>
              <button type="button" onClick={() => format("- ")} title="Bullet list">•</button>
            </div>

            <textarea
              ref={bodyRef}
              className="note-textarea"
              aria-label="Note text"
              rows={7}
              placeholder="Write the note. **bold**, *italic*, - lists and links all work."
              value={editing.body}
              onChange={e => setEditing(p => ({ ...p, body: e.target.value }))}
            />

            {(editing.body.trim() || editing.title.trim()) && (
              <div className="note-preview">
                <span className="note-preview-label">Preview</span>
                {editing.title && <h3 className="note-title">{editing.title}</h3>}
                <NoteBody text={editing.body} />
              </div>
            )}

            <div className="note-editor-row">
              <span className="note-colors" role="group" aria-label="Note colour">
                {NOTE_COLORS.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    aria-label={c.label}
                    aria-pressed={editing.color === c.id}
                    className={`note-swatch${editing.color === c.id ? " is-on" : ""}`}
                    style={{ background: c.bg, borderColor: c.edge }}
                    onClick={() => setEditing(p => ({ ...p, color: c.id }))}
                  />
                ))}
              </span>
              <label className="note-pin-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(editing.pinned)}
                  onChange={e => setEditing(p => ({ ...p, pinned: e.target.checked }))}
                />
                Pin to the top
              </label>
            </div>

            <div className="note-editor-grid">
              <label>
                Link a task
                <select
                  value={editing.taskId ?? ""}
                  onChange={e => setEditing(p => ({ ...p, taskId: e.target.value ? Number(e.target.value) : null }))}
                >
                  <option value="">None</option>
                  {taskItems.filter(t => t.active !== false).map(t => (
                    <option key={t.id} value={t.id}>{t.title}</option>
                  ))}
                </select>
              </label>
              <label>
                Link a recipe
                <select
                  value={editing.recipeId ?? ""}
                  onChange={e => setEditing(p => ({ ...p, recipeId: e.target.value ? Number(e.target.value) : null }))}
                >
                  <option value="">None</option>
                  {recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
            </div>

            <div className="note-photo-row">
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={choosePhoto} aria-label="Add a photo" />
              <button type="button" onClick={() => fileRef.current?.click()}>
                {editing._photo || (editing.image && !editing._removeImage) ? "Replace photo" : "Add photo"}
              </button>
              {(editing._photo || (editing.image && !editing._removeImage)) && (
                <>
                  <span className="note-photo-name">
                    {editing._photo ? `${editing._photo.name} · ${readableSize(editing._photo.size)}` : "Current photo"}
                  </span>
                  <button
                    type="button"
                    className="note-photo-remove"
                    onClick={() => setEditing(p => ({ ...p, _photo: null, _removeImage: true }))}
                  >
                    Remove
                  </button>
                </>
              )}
            </div>

            <div className="planner-modal-footer">
              <button className="planner-secondary-btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="planner-primary-btn" onClick={save} disabled={busy}>
                {busy ? "Saving" : "Save note"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setDeleteId(null)}>
          <div className="modal-box planner-modal planner-delete-modal">
            <p>Delete this note? This cannot be undone.</p>
            <div className="planner-modal-footer">
              <button className="planner-secondary-btn" onClick={() => setDeleteId(null)}>Cancel</button>
              <button className="planner-danger-btn" onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
