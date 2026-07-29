import { useMemo, useState } from "react";
import { growTree } from "./forest.js";
import { toMarkdown } from "./markdown.js";
import { jitter } from "./layout.js";

/* The Forest tab: every completed big branch that graduated from the Tree
   grows here as a natural tree, one card each, newest first — and beneath them
   the floor, where every done leaf that faded and fell off the Tree comes to
   rest. Leaves whose branch has since graduated bank at the foot of its tree;
   the rest drift together in a band along the bottom. */

const BARK_TOP = "#8C6239";
const BARK_BOT = "#5E3F26";
const LEAF_TONES = ["#5E8C4A", "#6FA05A", "#4F7A3E", "#82B267", "#3F6B33", "#9BC46F"];
const LITTER_TONES = ["#C9A227", "#B4863B", "#A9772E", "#8E6B3A", "#C08552", "#9C8749"];
// leaf blade rooted at (0,0), pointing up
const LEAF_D = "M0,0 C-5,-4 -5,-11 0,-16 C5,-11 5,-4 0,0 Z";
const CARD_H = 320;
const LITTER_CAP = 200; // blobs actually drawn; the true count is always labelled

// A fallen leaf always lands in the same spot, seeded by its own id.
const litterLeaf = (l, i, spread, drop, minScale, maxScale) => ({
  key: `${l.id}-${i}`,
  x: jitter(l.id, 21) * spread,
  y: (jitter(l.id, 22) + 0.5) * drop,
  rot: 55 + (jitter(l.id, 23) + 0.5) * 70, // lying near-flat on the ground
  scale: minScale + (jitter(l.id, 24) + 0.5) * (maxScale - minScale),
  fill: LITTER_TONES[i % LITTER_TONES.length],
});

function branchPath(b) {
  let dx = b.x2 - b.x1, dy = b.y2 - b.y1;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len; // unit perpendicular
  const h1 = b.w1 / 2, h2 = b.w2 / 2;
  return (
    `M${b.x1 + px * h1},${b.y1 + py * h1}` +
    `L${b.x2 + px * h2},${b.y2 + py * h2}` +
    `L${b.x2 - px * h2},${b.y2 - py * h2}` +
    `L${b.x1 - px * h1},${b.y1 - py * h1}Z`
  );
}

function TreeCard({ achievement, banked, onReturn }) {
  const { branches, leaves, bbox, size } = useMemo(
    () => growTree(achievement.tree),
    [achievement]
  );
  const gid = `bark-${achievement.id}`;
  const pad = 18;
  const vb = `${bbox.minX - pad} ${bbox.minY - pad} ${bbox.maxX - bbox.minX + pad * 2} ${bbox.maxY - bbox.minY + pad * 2}`;
  // trunk first (thick, behind), thin twigs last
  const ordered = [...branches].sort((a, b) => a.depth - b.depth);
  const groundR = Math.max(26, size * 1.1);
  const when = new Date(achievement.completedAt).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
  // markdown of every completed task in the branch (stored at graduation;
  // recomputed for trees planted before it was stored)
  const md = achievement.md ?? toMarkdown([achievement.tree]);
  // leaves shed before graduation were real tasks too, so they count
  const total = size + (achievement.shed ?? 0);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) { /* clipboard unavailable */ }
  };

  return (
    <figure className="ff-card">
      <svg viewBox={vb} preserveAspectRatio="xMidYMax meet" height={CARD_H} width="100%">
        <defs>
          <linearGradient id={gid} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor={BARK_BOT} />
            <stop offset="1" stopColor={BARK_TOP} />
          </linearGradient>
        </defs>
        {/* ground shadow at the trunk base */}
        <ellipse cx={0} cy={2} rx={groundR} ry={groundR * 0.22} className="ff-ground" />
        {/* leaves this branch shed while it was still growing, banked at its foot */}
        {banked.slice(-60).map((l, i) => {
          const b = litterLeaf(l, i, groundR * 1.9, 14, 0.45, 0.8);
          return (
            <path
              key={b.key}
              d={LEAF_D}
              className="ff-litterleaf"
              fill={b.fill}
              transform={`translate(${b.x},${b.y + 2}) rotate(${b.rot}) scale(${b.scale})`}
            />
          );
        })}
        {ordered.map((b, i) => (
          <g key={i}>
            <path d={branchPath(b)} fill={`url(#${gid})`} className="ff-branch" />
            {/* rounded joint so segments meet smoothly */}
            <circle cx={b.x1} cy={b.y1} r={b.w1 / 2} fill={`url(#${gid})`} className="ff-branch" />
          </g>
        ))}
        {leaves.map((l, i) => (
          <path
            key={i}
            d={LEAF_D}
            className="ff-leaf"
            fill={LEAF_TONES[l.tone % LEAF_TONES.length]}
            transform={`translate(${l.x},${l.y}) rotate(${l.rot}) scale(${l.r / 16})`}
            style={{ animationDelay: `${(i % 12) * 0.05}s` }}
          />
        ))}
      </svg>
      <figcaption className="ff-cap">
        <span className="ff-title">{achievement.title || "Untitled branch"}</span>
        <span className="ff-meta">
          🌿 {total} tasks{achievement.shed ? ` · ${achievement.shed} shed as leaves` : ""} · {when}
        </span>
        <div className="ff-cardactions">
          <button className="ff-copy" onClick={copy} title="Copy the completed tasks as markdown">
            {copied ? "✓ Copied" : "⧉ Copy .md"}
          </button>
          <button
            className="ff-copy"
            onClick={() => onReturn(achievement.id)}
            title="Move this branch back into the Tree"
          >
            ↩ Return to Tree
          </button>
        </div>
      </figcaption>
    </figure>
  );
}

/* Every fallen leaf that has no graduated tree to bank against, drifted
   together along the bottom of the tab. */
function LitterBand({ items }) {
  const shown = items.slice(-LITTER_CAP);
  return (
    <div className="ff-litter">
      <svg
        className="ff-litter-svg"
        viewBox="0 0 1000 88"
        preserveAspectRatio="xMidYMax slice"
        width="100%"
        height={88}
      >
        {shown.map((l, i) => {
          const b = litterLeaf(l, i, 1000, 62, 0.55, 1.05);
          return (
            <path
              key={b.key}
              d={LEAF_D}
              className="ff-litterleaf"
              fill={b.fill}
              transform={`translate(${b.x + 500},${b.y + 22}) rotate(${b.rot}) scale(${b.scale})`}
            />
          );
        })}
      </svg>
      <span className="ff-litter-label">
        🍂 {items.length} finished {items.length === 1 ? "leaf" : "leaves"} on the ground
        {items.length > LITTER_CAP ? ` · showing the ${LITTER_CAP} most recent` : ""}
      </span>
    </div>
  );
}

export default function Forest({ achievements, litter = [], onReturn }) {
  // a leaf banks against the deepest ancestor that has a tree here; whatever is
  // left over has no tree to belong to and joins the drift
  const bankedBy = new Map(achievements.map((a) => [a.id, []]));
  const drift = [];
  for (const l of litter) {
    const owner = (l.ancestorIds ?? []).filter((id) => bankedBy.has(id)).pop();
    if (owner) bankedBy.get(owner).push(l);
    else drift.push(l);
  }

  if (!achievements.length && !litter.length) {
    return (
      <div className="ff-empty">
        Your forest is bare. Finish every task in a branch of 10 or more and it’s
        cleared from the Tree and planted here as a tree you grew; smaller finished
        leaves fade, fall, and settle on the floor. 🌱
      </div>
    );
  }
  return (
    <div className="ff-wrap">
      <div className="ff-meadow">
        {achievements.map((a) => (
          <TreeCard
            key={a.id}
            achievement={a}
            banked={bankedBy.get(a.id) ?? []}
            onReturn={onReturn}
          />
        ))}
      </div>
      {drift.length > 0 && <LitterBand items={drift} />}
    </div>
  );
}
