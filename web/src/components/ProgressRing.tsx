// A small circular progress ring (single SVG circle, stroke-dashoffset). The
// arc length is clamped to 100% but the colour reflects the true ratio, so an
// over-budget month reads full + red. Colour sweeps green → orange → red.
export function ringColor(ratio: number): string {
  const r = Math.max(0, ratio);
  // 0 → green (145°), 0.8 → orange (38°), ≥1.2 → red (0°)
  const hue = r <= 0.8 ? 145 - (r / 0.8) * (145 - 38) : 38 - Math.min((r - 0.8) / 0.4, 1) * 38;
  return `hsl(${hue} 72% 58%)`;
}

export function ProgressRing({
  value, size = 24, stroke = 3, children,
}: { value: number; size?: number; stroke?: number; children?: React.ReactNode }) {
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(1, value));
  const color = ringColor(value);
  return (
    <span className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "scaleX(-1)" }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(233,230,223,0.12)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 0.5s cubic-bezier(0.2,0.8,0.2,1), stroke 0.3s ease" }}
        />
      </svg>
      {children && <span className="ring-center">{children}</span>}
    </span>
  );
}
