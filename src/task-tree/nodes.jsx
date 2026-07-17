import { statusByKey, typeByKey } from "./model.js";
import { PILL_H, labelOf, pillW } from "./layout.js";

/* Stateless SVG renderers for everything drawn on the canvas. `handlers` is
   the pointer/click bundle built once per node in TaskTreeApp. */

export function RootHub({ x, y, isDrop, onAdd }) {
  return (
    <g
      data-node="root"
      transform={`translate(${x},${y})`}
      className={`tt-hub ${isDrop ? "drop" : ""}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onAdd}
    >
      <circle r={17} />
      <text y={1} textAnchor="middle" dominantBaseline="middle" className="tt-hub-emoji">🌳</text>
      <title>Add a top-level task</title>
    </g>
  );
}

// Inner node of a fully-done subtree, folded into a bare twig;
// selecting expands it back to a pill.
export function DoneTwig({ node, x, y, isDrop, isDragging, handlers }) {
  return (
    <g
      data-node={node.id}
      transform={`translate(${x},${y})`}
      className={`tt-twig ${isDragging ? "dragging" : ""}`}
      {...handlers}
    >
      <g className="tt-twig-inner">
        <circle r={17} className="tt-realleaf-hit" />
        <path d="M-16,0 Q-2,2 15,-2 M-3,1 Q5,-3 10,-9 M3,0 Q9,5 14,8" className="tt-twig-wood" />
        <path d="M0,0 C-3,-3 -3,-8 0,-11 C3,-8 3,-3 0,0 Z" transform="translate(10,-9) rotate(40)" className="tt-twig-leaf" />
        <path d="M0,0 C-3,-3 -3,-8 0,-11 C3,-8 3,-3 0,0 Z" transform="translate(14,8) rotate(130)" className="tt-twig-leaf" />
      </g>
      {isDrop && <circle r={21} className="tt-drop-ring" />}
      <title>{node.title}{node.desc ? "\n" + node.desc : ""}</title>
    </g>
  );
}

// Done leaf task, folded into a real leaf; selecting expands it back to a pill.
export function DoneLeaf({ node, x, y, isDrop, isDragging, handlers }) {
  return (
    <g
      data-node={node.id}
      transform={`translate(${x},${y}) rotate(90)`}
      className={`tt-realleaf ${isDragging ? "dragging" : ""}`}
      {...handlers}
    >
      <g className="tt-realleaf-inner">
        <circle r={17} className="tt-realleaf-hit" />
        <path d="M0,9 Q1,15 -2,20" className="tt-realleaf-stem" />
        <path d="M0,10 C-10,2 -10,-10 0,-18 C10,-10 10,2 0,10 Z" className="tt-realleaf-blade" />
        <path d="M0,8 L0,-14 M0,2 Q-4,-1 -6,-5 M0,-2 Q4,-5 6,-9" className="tt-realleaf-vein" />
      </g>
      {isDrop && <circle r={21} className="tt-drop-ring" />}
      <title>{node.title}{node.desc ? "\n" + node.desc : ""}</title>
    </g>
  );
}

export function TaskPill({ node, x, y, isSel, isDone, isLeaf, isDrop, isDragging, handlers }) {
  const w = pillW(node);
  const st = node.status ? statusByKey[node.status] : null;
  const ty = node.type ? typeByKey[node.type] : null;
  return (
    <g
      data-node={node.id}
      transform={`translate(${x - w / 2},${y - PILL_H / 2})`}
      className={`tt-pill ${isSel ? "sel" : ""} ${isDone ? "done" : ""} ${isLeaf ? "leaf" : ""} ${node.important ? "imp" : ""} ${isDragging ? "dragging" : ""}`}
      {...handlers}
    >
      <rect width={w} height={PILL_H} rx={11} className="tt-pill-bg" />
      {st && (
        <rect width={4} height={PILL_H - 12} x={5} y={6} rx={2} fill={st.color} opacity={isDone ? 0.4 : 0.9} />
      )}
      {ty && (
        <text x={13} y={PILL_H / 2 + 1} dominantBaseline="middle" className="tt-pill-emoji">
          {ty.emoji}
        </text>
      )}
      <text x={ty ? 38 : 14} y={PILL_H / 2 + 1} dominantBaseline="middle" className="tt-pill-title">
        {labelOf(node.title)}
      </text>
      {st && (
        <text x={w - 23} y={PILL_H / 2 + 1} dominantBaseline="middle" className="tt-pill-emoji">
          {st.emoji}
        </text>
      )}
      {node.desc && <circle cx={w - 8} cy={8} r={2.6} className="tt-desc-dot" />}
      {isDrop && (
        <rect x={-3} y={-3} width={w + 6} height={PILL_H + 6} rx={13} className="tt-drop-ring" />
      )}
      {isSel && <rect width={w} height={PILL_H} rx={11} className="tt-pill-ring" />}
      <title>{node.title}{node.desc ? "\n" + node.desc : ""}</title>
    </g>
  );
}

// Floating copy of the node while drag-to-reparenting.
export function DragGhost({ node, x, y }) {
  const w = pillW(node);
  const ty = node.type ? typeByKey[node.type] : null;
  const st = node.status ? statusByKey[node.status] : null;
  return (
    <g
      className={`tt-ghost ${node.important ? "imp" : ""}`}
      style={{ pointerEvents: "none" }}
      transform={`translate(${x - w / 2},${y - PILL_H / 2})`}
    >
      <rect width={w} height={PILL_H} rx={11} className="tt-pill-bg" />
      {ty && (
        <text x={13} y={PILL_H / 2 + 1} dominantBaseline="middle" className="tt-pill-emoji">{ty.emoji}</text>
      )}
      <text x={ty ? 38 : 14} y={PILL_H / 2 + 1} dominantBaseline="middle" className="tt-pill-title">
        {labelOf(node.title)}
      </text>
      {st && (
        <text x={w - 23} y={PILL_H / 2 + 1} dominantBaseline="middle" className="tt-pill-emoji">{st.emoji}</text>
      )}
    </g>
  );
}

/* ---------- butterflies celebrating a freshly finished big branch ---------- */

// Butterfly wing, drawn to the left of the body; the right wing mirrors it.
const WING_D = "M0,-1 C-8,-9 -13,-3 -6,-.5 C-12,2 -8,8 0,3 Z";
const WING_COLORS = ["#E8A94F", "#D98A66", "#8A6FA6", "#7FAE93", "#D9789B"];

// Randomized flight parameters for `count` butterflies fanning upward.
export const makeFlock = (count) =>
  Array.from({ length: count }, () => {
    const a = -Math.PI * (0.12 + 0.76 * Math.random());
    const dist = 90 + Math.random() * 110;
    return {
      tx: Math.cos(a) * dist,
      ty: Math.sin(a) * dist - 20,
      dur: 2.2 + Math.random() * 1.6,
      delay: Math.random() * 0.7,
      rot: -25 + Math.random() * 50,
    };
  });

export function Butterflies({ flock, x, y }) {
  return (
    <g className="tt-bflock" transform={`translate(${x},${y})`}>
      {flock.map((b, i) => {
        const color = WING_COLORS[i % WING_COLORS.length];
        return (
          <g
            key={i}
            className="tt-bfly"
            style={{ "--tx": `${b.tx}px`, "--ty": `${b.ty}px`, animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s` }}
          >
            <g className="tt-bfly-sway" style={{ animationDelay: `${-i * 0.13}s` }}>
              <g transform={`rotate(${b.rot})`}>
                <path className="tt-bfly-wing" d={WING_D} fill={color} style={{ animationDelay: `${-i * 0.05}s` }} />
                <g transform="scale(-1,1)">
                  <path className="tt-bfly-wing" d={WING_D} fill={color} style={{ animationDelay: `${-i * 0.05}s` }} />
                </g>
                <ellipse rx={1.3} ry={4.6} className="tt-bfly-body" />
              </g>
            </g>
          </g>
        );
      })}
    </g>
  );
}
