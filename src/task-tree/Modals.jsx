import { useState } from "react";
import {
  STATUSES, TYPES, DEFAULT_STATUSES, DEFAULT_TYPES,
  PROTECTED_STATUS_KEYS, newTypeKey, newStatusKey,
} from "./model.js";
import { SAMPLE_MD } from "./markdown.js";

export function ImportModal({ text, setText, onImport, onClose, targetTitle }) {
  const intoNode = targetTitle != null;
  return (
    <div className="tt-scrim" onClick={onClose}>
      <div className="tt-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{intoNode ? <>Import into “{targetTitle || "task"}”</> : "Import markdown"}</h3>
        <p className="tt-note">
          Nested bullets become branches; numbered items (<code>1.</code>) work
          the same as bullets and can be mixed with them. A type emoji at the start of an item
          ({TYPES.map((t) => t.emoji).join(" ")}) and a status emoji at its end
          ({STATUSES.map((s) => s.emoji).join(" ")}) are picked up; items without a
          status emoji stay status-free. <code>- [x]</code> counts as done; lines
          starting with <code>&gt;</code> become the description of the item above.
          Titles written in <code>**bold**</code> are marked important and shown
          highlighted in the tree.
        </p>
        <textarea
          rows={12}
          autoFocus
          placeholder={SAMPLE_MD}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="tt-modal-actions">
          <button className="tt-btn ghost" onClick={onClose}>Cancel</button>
          <button className="tt-btn ghost" disabled={!text.trim()} onClick={() => onImport("append")}>{intoNode ? "Add as sub-tasks" : "Add to tree"}</button>
          <button className="tt-btn solid" disabled={!text.trim()} onClick={() => onImport("replace")}>{intoNode ? "Replace sub-tasks" : "Replace tree"}</button>
        </div>
      </div>
    </div>
  );
}

/* Customize the app-wide type/status vocabulary. Draft edits stay local until
   Save; each entry keeps its key so tasks already tagged with it are preserved.
   The lifecycle statuses (PROTECTED_STATUS_KEYS) can be restyled but not removed. */
export function VocabModal({ onSave, onClose }) {
  const [types, setTypes] = useState(() => TYPES.map((t) => ({ ...t })));
  const [statuses, setStatuses] = useState(() => STATUSES.map((s) => ({ ...s })));

  const patchType = (i, patch) =>
    setTypes((ts) => ts.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  const patchStatus = (i, patch) =>
    setStatuses((ss) => ss.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const addType = () =>
    setTypes((ts) => [...ts, { key: newTypeKey(), emoji: "🏷️", label: "New type" }]);
  const addStatus = () =>
    setStatuses((ss) => [...ss, { key: newStatusKey(), emoji: "•", label: "New status", color: "#8A8F98" }]);
  const removeType = (i) => setTypes((ts) => ts.filter((_, k) => k !== i));
  const removeStatus = (i) => setStatuses((ss) => ss.filter((_, k) => k !== i));
  const reset = () => {
    setTypes(DEFAULT_TYPES.map((t) => ({ ...t })));
    setStatuses(DEFAULT_STATUSES.map((s) => ({ ...s })));
  };

  const save = () => {
    onSave({
      types: types.map((t) => ({
        key: t.key,
        emoji: (t.emoji || "").trim() || "•",
        label: (t.label || "").trim() || "Untitled",
      })),
      statuses: statuses.map((s) => ({
        key: s.key,
        emoji: (s.emoji || "").trim() || "•",
        label: (s.label || "").trim() || "Untitled",
        color: s.color || "#8A8F98",
      })),
    });
  };

  return (
    <div className="tt-scrim" onClick={onClose}>
      <div className="tt-modal tt-vocab" onClick={(e) => e.stopPropagation()}>
        <h3>Customize types &amp; statuses</h3>
        <p className="tt-note">
          Edit the emoji and labels shown on tasks, in the panel and in the legend.
          Statuses also carry an accent colour. Built-in statuses the app’s
          progress logic depends on can be restyled but not removed.
        </p>

        <div className="tt-vocab-sec">
          <div className="tt-vocab-head">
            <span>Types</span>
            <button className="tt-btn ghost sm" onClick={addType}>+ Add type</button>
          </div>
          {types.map((t, i) => (
            <div className="tt-vocab-row" key={t.key}>
              <input
                className="tt-vocab-emoji"
                value={t.emoji}
                onChange={(e) => patchType(i, { emoji: e.target.value })}
                aria-label="Type emoji"
              />
              <input
                className="tt-vocab-label"
                value={t.label}
                onChange={(e) => patchType(i, { label: e.target.value })}
                aria-label="Type label"
              />
              <button
                className="tt-vocab-del"
                onClick={() => removeType(i)}
                title="Remove type"
                aria-label="Remove type"
              >🗑</button>
            </div>
          ))}
        </div>

        <div className="tt-vocab-sec">
          <div className="tt-vocab-head">
            <span>Statuses</span>
            <button className="tt-btn ghost sm" onClick={addStatus}>+ Add status</button>
          </div>
          {statuses.map((s, i) => {
            const locked = PROTECTED_STATUS_KEYS.includes(s.key);
            return (
              <div className="tt-vocab-row" key={s.key}>
                <input
                  className="tt-vocab-emoji"
                  value={s.emoji}
                  onChange={(e) => patchStatus(i, { emoji: e.target.value })}
                  aria-label="Status emoji"
                />
                <input
                  className="tt-vocab-label"
                  value={s.label}
                  onChange={(e) => patchStatus(i, { label: e.target.value })}
                  aria-label="Status label"
                />
                <input
                  className="tt-vocab-color"
                  type="color"
                  value={s.color}
                  onChange={(e) => patchStatus(i, { color: e.target.value })}
                  aria-label="Status colour"
                />
                <button
                  className="tt-vocab-del"
                  onClick={() => removeStatus(i)}
                  disabled={locked}
                  title={locked ? "Built-in status — can’t be removed" : "Remove status"}
                  aria-label="Remove status"
                >{locked ? "🔒" : "🗑"}</button>
              </div>
            );
          })}
        </div>

        <div className="tt-modal-actions">
          <button className="tt-btn ghost" onClick={reset}>Reset to defaults</button>
          <span className="tt-modal-spacer" />
          <button className="tt-btn ghost" onClick={onClose}>Cancel</button>
          <button className="tt-btn solid" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

export function ExportModal({
  markdown,
  copied,
  onCopy,
  onClose,
  onSync,
  onPickSyncFile,
  onReload,
  canReload,
  fileChanged,
  syncState,
  syncFileName,
}) {
  const syncLabel =
    syncState === "syncing" ? "Syncing…" :
    syncState === "synced" ? "Synced ✓" :
    syncState === "error" ? "Sync failed" :
    syncFileName ? "Sync" : "Sync…";
  return (
    <div className="tt-scrim" onClick={onClose}>
      <div className="tt-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Export markdown</h3>
        <textarea rows={12} readOnly value={markdown} onFocus={(e) => e.currentTarget.select()} />
        {syncFileName && (
          <p className="tt-note">
            Syncing to <code>{syncFileName}</code>
            {" · "}
            <button type="button" className="tt-linkbtn" onClick={onPickSyncFile}>change file</button>
            {fileChanged && <> · <strong>changed on disk</strong></>}
          </p>
        )}
        <div className="tt-modal-actions">
          <button className="tt-btn ghost" onClick={onClose}>Close</button>
          {canReload && (
            <button className="tt-btn ghost" onClick={onReload} disabled={syncState === "syncing"}>Reload from file</button>
          )}
          <button className="tt-btn ghost" onClick={onSync} disabled={syncState === "syncing"}>{syncLabel}</button>
          <button className="tt-btn solid" onClick={onCopy}>{copied ? "Copied ✓" : "Copy"}</button>
        </div>
      </div>
    </div>
  );
}
