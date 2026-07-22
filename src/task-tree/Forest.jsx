import { useMemo, useState } from "react";
import { growTree } from "./forest.js";
import { toMarkdown } from "./markdown.js";

/* The Forest tab: every completed big branch that graduated from the Tree
   grows here as a natural tree, one card each, newest first. */

const BARK_TOP = "#8C6239";
const BARK_BOT = "#5E3F26";
const LEAF_TONES = ["#5E8C4A", "#6FA05A", "#4F7A3E", "#82B267", "#3F6B33", "#9BC46F"];
// leaf blade rooted at (0,0), pointing up
const LEAF_D = "M0,0 C-5,-4 -5,-11 0,-16 C5,-11 5,-4 0,0 Z";
const CARD_H = 320;

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

function TreeCard({ achievement, onReturn }) {
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
        <span className="ff-meta">🌿 {size} tasks · {when}</span>
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

export default function Forest({ achievements, onReturn }) {
  if (!achievements.length) {
    return (
      <div className="ff-empty">
        Your forest is bare. Finish every task in a top-level branch of 10 or more,
        and it’s cleared from the Tree and planted here as a tree you grew. 🌱
      </div>
    );
  }
  return (
    <div className="ff-wrap">
      <div className="ff-meadow">
        {achievements.map((a) => (
          <TreeCard key={a.id} achievement={a} onReturn={onReturn} />
        ))}
      </div>
    </div>
  );
}
