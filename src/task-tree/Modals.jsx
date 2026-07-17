import { STATUSES, TYPES } from "./model.js";
import { SAMPLE_MD } from "./markdown.js";

export function ImportModal({ text, setText, onImport, onClose }) {
  return (
    <div className="tt-scrim" onClick={onClose}>
      <div className="tt-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Import markdown</h3>
        <p className="tt-note">
          Nested bullets become branches. A type emoji at the start of an item
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
          <button className="tt-btn ghost" disabled={!text.trim()} onClick={() => onImport("append")}>Add to tree</button>
          <button className="tt-btn solid" disabled={!text.trim()} onClick={() => onImport("replace")}>Replace tree</button>
        </div>
      </div>
    </div>
  );
}

export function ExportModal({ markdown, copied, onCopy, onClose }) {
  return (
    <div className="tt-scrim" onClick={onClose}>
      <div className="tt-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Export markdown</h3>
        <textarea rows={12} readOnly value={markdown} onFocus={(e) => e.currentTarget.select()} />
        <div className="tt-modal-actions">
          <button className="tt-btn ghost" onClick={onClose}>Close</button>
          <button className="tt-btn solid" onClick={onCopy}>{copied ? "Copied ✓" : "Copy"}</button>
        </div>
      </div>
    </div>
  );
}
