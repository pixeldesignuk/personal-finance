import type { CSSProperties, ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// A draggable dashboard section, used inside a SortableContext while the
// dashboard is in "Customize" mode. Drag is initiated only from the grip handle
// (top-left corner), so toggles/links inside the block stay clickable.
export function SortableBlock({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.75 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className={`sortable-block${isDragging ? " dragging" : ""}`}>
      <button className="drag-handle" {...attributes} {...listeners} aria-label="Drag to reorder" title="Drag to reorder">⠿</button>
      {children}
    </div>
  );
}
