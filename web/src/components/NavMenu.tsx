import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { NavLink, useLocation } from "react-router-dom";

export interface NavItem { to: string; label: string; end?: boolean }

// A top-nav dropdown built on Radix: click to open, portalled + popper-positioned,
// handles outside-click / Esc / keyboard. Trigger highlights when a child is active.
export function NavMenu({ label, items }: { label: string; items: NavItem[] }) {
  const { pathname } = useLocation();
  const active = items.some((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to)));

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={`nav-group-trigger${active ? " active" : ""}`}>
          {label}<span className="nav-caret" aria-hidden>▾</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="nav-menu" align="start" sideOffset={12}>
          {items.map((i) => (
            <DropdownMenu.Item key={i.to} asChild>
              <NavLink to={i.to} end={i.end}>{i.label}</NavLink>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
