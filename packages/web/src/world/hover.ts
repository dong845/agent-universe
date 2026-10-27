import type { ThreeEvent } from "@react-three/fiber";
import { useStore, type HoverTarget } from "../store.ts";

/** pointer handlers that make a mesh group report itself as the hovered object */
export function hoverHandlers(target: HoverTarget) {
  const key = JSON.stringify(target);
  return {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      useStore.getState().setHovered(target);
    },
    onPointerOut: () => {
      const h = useStore.getState().hovered;
      if (h && JSON.stringify(h) === key) useStore.getState().setHovered(null);
    },
  };
}
