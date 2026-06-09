import { useEffect, useRef, useState } from "react";
import {
  PiggyBank, ShieldCheck, GraduationCap, Home, Car, Plane, Gift, Heart, Baby,
  Stethoscope, Wrench, PartyPopper, Sparkles, Wallet, Landmark, TrendingUp,
  Umbrella, Gem, Laptop, Dog, type LucideIcon,
} from "lucide-react";

// Curated goal icons. The pot stores the `key`; legacy/emoji values still render.
export const POT_ICONS: { key: string; label: string; Icon: LucideIcon }[] = [
  { key: "piggy-bank", label: "Savings", Icon: PiggyBank },
  { key: "shield", label: "Emergency fund", Icon: ShieldCheck },
  { key: "graduation", label: "Education", Icon: GraduationCap },
  { key: "home", label: "Home", Icon: Home },
  { key: "car", label: "Car", Icon: Car },
  { key: "plane", label: "Travel", Icon: Plane },
  { key: "gift", label: "Gifts", Icon: Gift },
  { key: "heart", label: "Loved ones", Icon: Heart },
  { key: "baby", label: "Baby", Icon: Baby },
  { key: "health", label: "Health", Icon: Stethoscope },
  { key: "repairs", label: "Repairs", Icon: Wrench },
  { key: "celebration", label: "Celebration", Icon: PartyPopper },
  { key: "wedding", label: "Wedding", Icon: Gem },
  { key: "rainy-day", label: "Rainy day", Icon: Umbrella },
  { key: "investing", label: "Investing", Icon: TrendingUp },
  { key: "tech", label: "Tech", Icon: Laptop },
  { key: "pet", label: "Pet", Icon: Dog },
  { key: "treats", label: "Treats", Icon: Sparkles },
  { key: "general", label: "General", Icon: Wallet },
  { key: "tax", label: "Tax / bills", Icon: Landmark },
];
const ICON_MAP = new Map(POT_ICONS.map((i) => [i.key, i.Icon]));

// Render a pot's icon: a Lucide glyph by key, a legacy emoji string, or default.
export function PotIcon({ icon, size = 18 }: { icon: string | null; size?: number }) {
  const Icon = icon ? ICON_MAP.get(icon) : undefined;
  if (Icon) return <Icon size={size} strokeWidth={1.9} />;
  if (icon) return <span style={{ fontSize: size }}>{icon}</span>;
  return <PiggyBank size={size} strokeWidth={1.9} />;
}

// A small dropdown that picks one of the curated icons.
export function IconPicker({ value, onChange }: { value: string | null; onChange: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="icon-picker" ref={ref}>
      <button type="button" className="icon-picker-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Choose an icon">
        <PotIcon icon={value} size={20} />
        <span className="nav-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="icon-picker-pop">
          {POT_ICONS.map(({ key, label, Icon }) => (
            <button type="button" key={key} className={`icon-opt${value === key ? " active" : ""}`} title={label} onClick={() => { onChange(key); setOpen(false); }}>
              <Icon size={18} strokeWidth={1.9} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
