import type { ThreeEvent } from "@react-three/fiber";
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

/** whether `target` is the hovered object, for the outline highlight */
export function useIsHovered(target: HoverTarget): boolean {
  const key = JSON.stringify(target);
  return useStore((s) => (s.hovered ? JSON.stringify(s.hovered) === key : false));
}
