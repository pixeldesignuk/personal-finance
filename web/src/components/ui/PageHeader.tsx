import type { ReactNode } from "react";

// The standard page top: an <h1> with optional right-aligned actions and a
// muted subtitle beneath. Replaces the repeated
// `<div className="row-between"><h1>…</h1>…</div>` + `<p className="muted"
// style={{ marginTop: -6 }}>` pattern on every page.
export function PageHeader({ title, subtitle, actions }: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <>
      <div className="page-head">
        <h1>{title}</h1>
        {actions != null && <div className="toolbar">{actions}</div>}
      </div>
      {subtitle != null && <p className="page-subtitle">{subtitle}</p>}
    </>
  );
}
