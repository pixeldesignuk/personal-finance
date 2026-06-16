import type { AccountHealthDTO } from "../../../shared/types.ts";

// Health ring overlaid on an account avatar. Color = verdict (green/amber/red).
// A healthy account shows a full ring; amber/red fill to the runway coverage so
// the unfilled remainder reads as the gap. The incoming arc continues from the
// solid one (the paycheck closing a shortfall).
export function HealthRing({ health, size = 56 }: { health?: AccountHealthDTO; size?: number }) {
  if (!health) return null;
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const solid = health.verdict === "ok" ? 1 : Math.max(0, Math.min(1, health.ring.solidFraction));
  const dashed = Math.max(0, Math.min(1 - solid, health.ring.dashedFraction));
  const center = size / 2;
  const rot = `rotate(-90 ${center} ${center})`;
  return (
    <svg className={`health-ring ${health.color}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="track" cx={center} cy={center} r={r} fill="none" strokeWidth={stroke} />
      {dashed > 0 && (
        <circle className="incoming" cx={center} cy={center} r={r} fill="none" strokeWidth={stroke}
          strokeDasharray={`${dashed * c} ${c}`} strokeDashoffset={-solid * c} transform={rot} strokeLinecap="round" />
      )}
      {solid > 0 && (
        <circle className="solid" cx={center} cy={center} r={r} fill="none" strokeWidth={stroke}
          strokeDasharray={`${solid * c} ${c}`} transform={rot} strokeLinecap="round" />
      )}
    </svg>
  );
}
