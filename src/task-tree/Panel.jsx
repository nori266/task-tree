import { STATUSES, TYPES } from "./model.js";

/* Detail side panel for the selected task. `onPatch` merges a partial update
   into the selected node; delete asks for a second click to confirm. */

export default function Panel({
  selected, titleInputRef, confirmDelete, setConfirmDelete,
  onPatch, onAddChild, onImportChild, onDelete, onClose,
}) {
  return (
    <aside className={`tt-panel ${selected ? "open" : ""}`}>
      {selected && (
        <>
          <div className="tt-panel-head">
            <span className="tt-panel-eyebrow">Task</span>
            <button className="tt-x" onClick={onClose} aria-label="Close panel">×</button>
          </div>

          <div className="tt-panel-body">
            <label className="tt-field">
              <span>Title</span>
              <input
                ref={titleInputRef}
                value={selected.title}
                onChange={(e) => onPatch({ title: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
            </label>

            <label className="tt-field">
              <span>Description</span>
              <textarea
                rows={2}
                placeholder="Notes, links, context…"
                value={selected.desc}
                onChange={(e) => onPatch({ desc: e.target.value })}
              />
            </label>

            <div className="tt-field">
              <span>Type</span>
              <div className="tt-types">
                <button
                  className={`tt-chip ${!selected.type ? "on" : ""}`}
                  onClick={() => onPatch({ type: null })}
                >
                  — None
                </button>
                {TYPES.map((t) => (
                  <button
                    key={t.key}
                    className={`tt-chip ${selected.type === t.key ? "on" : ""}`}
                    onClick={() => onPatch({ type: t.key })}
                  >
                    {t.emoji} {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="tt-field">
              <span>Importance</span>
              <div className="tt-types">
                <button
                  className={`tt-chip ${selected.important ? "on" : ""}`}
                  onClick={() => onPatch({ important: !selected.important })}
                >
                  ★ Important
                </button>
              </div>
            </div>

            <div className="tt-field">
              <span>Status</span>
              <div className="tt-statuses">
                <button
                  className={`tt-status ${!selected.status ? "on" : ""}`}
                  style={{ "--sc": "#9AA79E" }}
                  onClick={() => onPatch({ status: null })}
                >
                  <b>—</b>No status
                </button>
                {STATUSES.map((s) => (
                  <button
                    key={s.key}
                    className={`tt-status ${selected.status === s.key ? "on" : ""}`}
                    style={{ "--sc": s.color }}
                    onClick={() => onPatch({ status: s.key })}
                  >
                    <b>{s.emoji}</b>{s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="tt-panel-foot">
            <button className="tt-btn solid wide" onClick={onAddChild}>
              + Add sub-task
            </button>
            <button className="tt-btn ghost wide" onClick={onImportChild}>
              Import sub-tasks from .md
            </button>
            <button
              className={`tt-btn danger wide ${confirmDelete ? "confirm" : ""}`}
              onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
              onBlur={() => setConfirmDelete(false)}
            >
              {confirmDelete
                ? `Really delete${selected.children.length ? " (with sub-tasks)" : ""}?`
                : "Delete task"}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
