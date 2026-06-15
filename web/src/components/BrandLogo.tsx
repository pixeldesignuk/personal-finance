import { useEffect, useState } from "react";

// Deterministic hue from a string so the same merchant always gets the same colour.
function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

// A brand avatar: a real logo image when one resolves (filling the whole circle),
// otherwise a monogram tile coloured deterministically from the name. `src` may
// be a single URL or an ordered candidate list, each tried before the monogram.
export function BrandLogo({ name, src, size = 34 }: { name: string; src?: string | null | string[]; size?: number }) {
  const candidates = (Array.isArray(src) ? src : src ? [src] : []).filter(Boolean);
  const key = candidates.join("|");
  const [idx, setIdx] = useState(0);
  // Reset to the first candidate whenever the set of URLs changes (e.g. domain edit).
  useEffect(() => { setIdx(0); }, [key]);

  const current = candidates[idx];
  const hue = hashHue(name || "?");

  return (
    <span
      className={`brand-logo${current ? " has-img" : ""}`}
      style={current ? { width: size, height: size } : {
        width: size, height: size,
        background: `linear-gradient(140deg, hsl(${hue} 42% 24%), hsl(${hue} 38% 14%))`,
        color: `hsl(${hue} 65% 74%)`,
        borderColor: `hsl(${hue} 40% 30% / 0.5)`,
      }}
      aria-hidden
    >
      {current
        ? <img src={current} alt="" width={size} height={size} loading="lazy" onError={() => setIdx((i) => i + 1)} />
        : <span className="brand-mono" style={{ fontSize: Math.round(size * 0.4) }}>{initials(name || "?")}</span>}
    </span>
  );
}
