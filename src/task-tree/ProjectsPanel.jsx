import { useState, useRef, useEffect } from "react";
import { PROJECT_COLORS } from "./projects.js";

/* Left sidebar listing every project. Click a row to switch; each row renames
   inline (double-click or the ✎ button) and deletes with a two-click confirm.
   A freshly created project opens straight into its rename field. The leading
   swatch opens a palette to set (or clear) that project's background tint. */

export default function ProjectsPanel({
  projects, activeId, collapsed, onToggle,
  onSwitch, onCreate, onRename, onDelete, onRecolor, onBackup, onRestore,
}) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");
  const [confirmId, setConfirmId] = useState(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [paletteId, setPaletteId] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editingId) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (!paletteId) return;
    const onDown = (e) => {
      if (!e.target.closest?.(".tt-proj-swatch-wrap")) setPaletteId(null);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [paletteId]);

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
          const showPalette = p.id === paletteId;
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
                  <span className="tt-proj-swatch-wrap">
                    <button
                      className="tt-proj-swatch"
                      style={{ background: p.color || "transparent" }}
                      onClick={() => {
                        setConfirmId(null);
                        setPaletteId((c) => (c === p.id ? null : p.id));
                      }}
                      title="Project color"
                      aria-label="Set project color"
                    >{p.color ? "" : "○"}</button>
                    {showPalette && (
                      <div className="tt-proj-palette">
                        {PROJECT_COLORS.map((c) => (
                          <button
                            key={c}
                            className={`tt-proj-chip ${p.color === c ? "on" : ""}`}
                            style={{ background: c }}
                            onClick={() => { onRecolor(p.id, c); setPaletteId(null); }}
                            title={c}
                            aria-label={`Use ${c}`}
                          />
                        ))}
                        <button
                          className={`tt-proj-chip none ${!p.color ? "on" : ""}`}
                          onClick={() => { onRecolor(p.id, null); setPaletteId(null); }}
                          title="No color"
                          aria-label="No color"
                        >✕</button>
                      </div>
                    )}
                  </span>
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
      <div className="tt-proj-backup">
        <button className="tt-proj-backup-btn" onClick={onBackup} title="Save a full backup of every project to a JSON file">
          Backup
        </button>
        <button
          className={`tt-proj-backup-btn ${confirmRestore ? "confirm" : ""}`}
          onClick={() => {
            if (confirmRestore) { setConfirmRestore(false); onRestore(); }
            else setConfirmRestore(true);
          }}
          onBlur={() => setConfirmRestore(false)}
          title={confirmRestore ? "Replaces all current projects — click again" : "Restore all projects from a backup file"}
        >
          {confirmRestore ? "Replace all?" : "Restore"}
        </button>
      </div>
    </aside>
  );
}
