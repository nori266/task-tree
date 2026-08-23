import { useMemo } from "react";
import { statusByKey, typeByKey } from "./model.js";
import { labelOf } from "./layout.js";
import { linearize } from "./linearize.js";

/* The Linearize view: the active part of the tree flattened into a single
   ordered stack of what to work on next, top to bottom. See linearize.js for
   the ordering rules. Picking a card jumps back to the Tree on that task. */

export default function Linearize({ nodes, onPick }) {
  const order = useMemo(() => linearize(nodes), [nodes]);

  if (!order.length) {
    return (
      <div className="ff-empty">
        Nothing to line up yet. Give a task the status <b>In progress</b>,
        <b> Will do next</b> or <b>Waiting to start</b> and it — with everything
        under it — will stack up here in the order to tackle it. 📋
      </div>
    );
  }

  return (
    <div className="tt-lin">
      <div className="tt-lin-stack">
        {order.map((n) => {
          const st = n.status ? statusByKey[n.status] : null;
          const ty = n.type ? typeByKey[n.type] : null;
          return (
            <button
              key={n.id}
              className={`tt-lin-card ${n.important ? "imp" : ""}`}
              style={st ? { borderLeftColor: st.color } : undefined}
              onClick={() => onPick(n.id)}
              title={n.desc || n.title}
            >
              {ty && <span className="tt-lin-emoji">{ty.emoji}</span>}
              <span className="tt-lin-title">{labelOf(n.title)}</span>
              {st && <span className="tt-lin-status">{st.emoji}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
