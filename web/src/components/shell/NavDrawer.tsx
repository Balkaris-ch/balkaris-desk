"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icons";

interface Drawer {
  open: boolean;
  set: (open: boolean) => void;
}

const Ctx = createContext<Drawer>({ open: false, set: () => {} });

/** Whether the phone's sidebar drawer is open, and the way to open or close it. */
export const useDrawer = (): Drawer => useContext(Ctx);

/**
 * The frame's outer box. On a wide screen it is only a grid. On a narrow one
 * the sidebar is a drawer, and this remembers whether it is open: it closes
 * when the address changes (a row was tapped), on Escape, and on a tap
 * outside. The sidebar and the screens pass through as children and stay
 * server components.
 */
export function ShellRoot({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open]);

  const value = useMemo(() => ({ open, set: setOpen }), [open]);

  return (
    <Ctx.Provider value={value}>
      <div className="dk-shell" data-nav={open ? "open" : "shut"}>
        {children}
        <button type="button" className="dk-shell-scrim" aria-label="Close the menu" tabIndex={open ? 0 : -1} onClick={() => setOpen(false)} />
      </div>
    </Ctx.Provider>
  );
}

/** The top bar's menu button. Drawn only where the sidebar is a drawer. */
export function MenuButton() {
  const { open, set } = useDrawer();
  return (
    <button type="button" className="dk-top-menu" aria-label={open ? "Close the menu" : "Open the menu"} aria-expanded={open} aria-controls="dk-side" onClick={() => set(!open)}>
      <Icon name={open ? "x" : "menu"} size={20} />
    </button>
  );
}
