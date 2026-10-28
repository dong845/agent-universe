import type { ThreeEvent } from "@react-three/fiber";
import type { Selection } from "../selection.ts";
import { useStore, type HoverTarget } from "../store.ts";

/** pointer handlers that make a mesh group report itself as the hovered object */
export function hoverHandlers(target: HoverTarget) {
  const key = JSON.stringify(target);
  return {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      useStore.getState().setHovered(target);
      document.body.style.cursor = "pointer";
    },
    onPointerOut: () => {
      const h = useStore.getState().hovered;
      if (h && JSON.stringify(h) === key) {
        useStore.getState().setHovered(null);
        document.body.style.cursor = "";
      }
    },
  };
}

/** a pointer that moved more than this between press and release was dragging the view, not clicking */
export const CLICK_SLOP_PX = 5;

/** a click (not a drag) selects `sel` */
export function selectOnClick(sel: Selection | ((e: ThreeEvent<MouseEvent>) => Selection | null)) {
  return (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > CLICK_SLOP_PX) return;
    const s = typeof sel === "function" ? sel(e) : sel;
    if (!s) return;
    e.stopPropagation();
    useStore.getState().select(s);
  };
}

/** whether `target` is the hovered object, for the outline highlight */
export function useIsHovered(target: HoverTarget): boolean {
  const key = JSON.stringify(target);
  return useStore((s) => (s.hovered ? JSON.stringify(s.hovered) === key : false));
}
