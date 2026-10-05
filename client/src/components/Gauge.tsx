import { motion, useReducedMotion } from "framer-motion";

const CX = 150, CY = 150, R = 120;
const pt = (score: number, r = R) => {
  const a = Math.PI * (1 - score / 100);
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
};
const arc = (from: number, to: number) => {
  const [x1, y1] = pt(from), [x2, y2] = pt(to);
  return `M ${x1} ${y1} A ${R} ${R} 0 0 1 ${x2} ${y2}`;
};

export function verdictColor(score: number) {
  return score >= 65 ? "var(--green)" : score >= 40 ? "var(--amber)" : "var(--red)";
}

export default function Gauge({ score, label, size = 300 }: { score: number | null; label?: string; size?: number }) {
  const reduce = useReducedMotion();
  const angle = score === null ? -90 : (score / 100) * 180 - 90;
  return (
    <figure className="m-0 text-center" style={{ width: size, maxWidth: "100%" }} aria-label={score === null ? "Trust gauge, no score yet" : `Trust score ${score} out of 100`}>
      <svg viewBox="0 0 300 175" className="w-full overflow-visible">
        <path d={arc(0, 100)} stroke="var(--line)" strokeWidth="26" fill="none" strokeLinecap="round" />
        <path d={arc(1.5, 38.5)} stroke="var(--red)" strokeWidth="22" fill="none" />
        <path d={arc(41.5, 63.5)} stroke="var(--amber)" strokeWidth="22" fill="none" />
        <path d={arc(66.5, 98.5)} stroke="var(--green)" strokeWidth="22" fill="none" />
        <motion.g
          style={{ originX: `${CX}px`, originY: `${CY}px` }}
          initial={{ rotate: reduce ? angle : -90 }}
          animate={{ rotate: angle }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 55, damping: 11, mass: 1.1 }}
        >
          <path d={`M ${CX - 6} ${CY} L ${CX} ${CY - 104} L ${CX + 6} ${CY} Z`} fill="var(--ink)" />
        </motion.g>
        <circle cx={CX} cy={CY} r="11" fill="var(--ink)" />
        <circle cx={CX} cy={CY} r="4" fill="var(--paper)" />
        <text x={CX} y={CY - 38} textAnchor="middle" fontFamily="Bricolage Grotesque, sans-serif" fontSize="44" fontWeight="800" fill="var(--ink)">{score ?? "--"}</text>
      </svg>
      {label && <figcaption className="font-display text-2xl font-bold -mt-1" style={{ color: score === null ? "var(--muted)" : verdictColor(score) }}>{label}</figcaption>}
    </figure>
  );
}
