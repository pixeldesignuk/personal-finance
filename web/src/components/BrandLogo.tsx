import { useState } from "react";

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

// A brand avatar: shows a real logo image when `src` is given (banks have
// GoCardless logos), otherwise — or if the image 404s — a tasteful monogram
// tile coloured deterministically from the name.
export function BrandLogo({ name, src, size = 34 }: { name: string; src?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const showImg = Boolean(src) && !broken;
  const hue = hashHue(name || "?");

  return (
    <span
      className={`brand-logo${showImg ? " has-img" : ""}`}
      style={showImg ? { width: size, height: size } : {
        width: size, height: size,
        background: `linear-gradient(140deg, hsl(${hue} 42% 24%), hsl(${hue} 38% 14%))`,
        color: `hsl(${hue} 65% 74%)`,
        borderColor: `hsl(${hue} 40% 30% / 0.5)`,
      }}
      aria-hidden
    >
      {showImg
        ? <img src={src!} alt="" width={size} height={size} loading="lazy" onError={() => setBroken(true)} />
        : <span className="brand-mono" style={{ fontSize: Math.round(size * 0.4) }}>{initials(name || "?")}</span>}
    </span>
  );
}
