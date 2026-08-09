import { useState, useRef, useEffect } from "react";

/* Left sidebar listing every project. Click a row to switch; each row renames
   inline (double-click or the ✎ button) and deletes with a two-click confirm.
   A freshly created project opens straight into its rename field. */

export default function ProjectsPanel({
  projects, activeId, collapsed, onToggle,
  onSwitch, onCreate, onRename, onDelete,
}) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");
  const [confirmId, setConfirmId] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editingId) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingId]);

  const beginRename = (p) => {
    setConfirmId(null);
    setDraft(p.title);
    setEditingId(p.id);
  };
  const commitRename = () => {
    if (editingId) onRename(editingId, draft);
    setEditingId(null);
  };

  if (collapsed) {
    return (
      <div className="tt-projects collapsed">
        <button className="tt-proj-toggle" onClick={onToggle} title="Show projects" aria-label="Show projects">
          ☰
        </button>
      </div>
    );
  }

  return (
    <aside className="tt-projects">
      <div className="tt-proj-head">
        <span className="tt-proj-eyebrow">Projects</span>
        <button className="tt-proj-toggle" onClick={onToggle} title="Hide projects" aria-label="Hide projects">
          ‹
        </button>
      </div>
      <ul className="tt-proj-list">
        {projects.map((p) => {
          const isActive = p.id === activeId;
          const isEditing = p.id === editingId;
          return (
            <li key={p.id} className={`tt-proj-item ${isActive ? "on" : ""}`}>
              {isEditing ? (
                <input
                  ref={inputRef}
                  className="tt-proj-rename"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    else if (e.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <>
                  <button
                    className="tt-proj-name"
                    onClick={() => onSwitch(p.id)}
                    onDoubleClick={() => beginRename(p)}
                    title={p.title}
                  >
                    {p.title || "Untitled"}
                  </button>
                  <span className="tt-proj-actions">
                    <button
                      className="tt-proj-icon"
                      onClick={() => beginRename(p)}
                      title="Rename project"
                      aria-label="Rename project"
                    >✎</button>
                    <button
                      className={`tt-proj-icon danger ${confirmId === p.id ? "confirm" : ""}`}
                      onClick={() => {
                        if (confirmId === p.id) { onDelete(p.id); setConfirmId(null); }
                        else setConfirmId(p.id);
                      }}
                      onBlur={() => setConfirmId((c) => (c === p.id ? null : c))}
                      title={confirmId === p.id ? "Click again to delete" : "Delete project"}
                      aria-label="Delete project"
                    >{confirmId === p.id ? "✓?" : "🗑"}</button>
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <button
        className="tt-proj-new"
        onClick={() => {
          const id = onCreate();
          if (id) { setDraft("New project"); setEditingId(id); }
        }}
      >
        + New project
      </button>
    </aside>
  );
}
