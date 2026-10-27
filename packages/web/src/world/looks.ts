// Visual directions. Each look is the whole art-direction in one object: sky, terrain, colour
// language, shading, lights and post-processing. Picked with ?look=toy|dusk|board.
import type { BuildingId } from "../../../schema/src/world.ts";
import { useStore } from "../store.ts";

export type LookId = "toy" | "dusk" | "board";
export type Shading = "soft" | "faceted" | "toon";

export interface Look {
  id: LookId;
  name: string;
  /** CSS background behind the transparent canvas */
  sky: string;
  fog?: { color: string; near: number; far: number };
  terrain: "island" | "isle-water" | "board";
  shading: Shading;
  rounded: boolean;
  outline: string | null;
  ground: { top: string; topDark: string; soil: string; soilDark: string; path: string; plaza: string; water?: string };
  roof: string;
  trim: string;
  wood: string;
  /** wall / accent per building: each building owns a colour, the faction owns the roofs */
  building: Record<BuildingId, { wall: string; accent: string }>;
  hall: { wall: string; accent: string };
  foliage: string[];
  trunk: string;
  skin: string;
  light: {
    hemi: [sky: string, ground: string, intensity: number];
    sun: { color: string; intensity: number; pos: [number, number, number] };
    fill?: { color: string; intensity: number; pos: [number, number, number] };
  };
  post: { ao: number; bloom: number; tiltShift: number; vignette: number; saturation: number };
  windowGlow: string;
  labelClass: string;
}

export const LOOKS: Record<LookId, Look> = {
  // A — warm clay toy town (Townscaper / Animal Crossing): soft, rounded, miniature
  toy: {
    id: "toy",
    name: "暖陶玩具镇",
    sky: "radial-gradient(120% 90% at 50% 35%, #fff7ea 0%, #f7e3cb 55%, #ecc9a8 100%)",
    terrain: "island",
    shading: "soft",
    rounded: true,
    outline: "#3b2a20",
    ground: { top: "#a9d18e", topDark: "#93c178", soil: "#c48a5c", soilDark: "#8e5a3a", path: "#f4e1bb", plaza: "#ecd3a3" },
    roof: "#d4663f",
    trim: "#fff6e6",
    wood: "#a8754b",
    building: {
      library: { wall: "#f7ebd3", accent: "#c95f3c" },
      forge: { wall: "#7a6b63", accent: "#ff8a3d" },
      workshop: { wall: "#a8dcc9", accent: "#5f8f80" },
      training: { wall: "#8fcf72", accent: "#ffffff" },
      port: { wall: "#c99a68", accent: "#79c7da" },
      embassy: { wall: "#fffaf0", accent: "#58b3a4" },
      council: { wall: "#f0aaa4", accent: "#c76b63" },
      studio: { wall: "#cdb9ea", accent: "#8f6cc7" },
      control: { wall: "#86a0c4", accent: "#3f5f8f" },
    },
    hall: { wall: "#ffe6b8", accent: "#d4663f" },
    foliage: ["#7dbb6a", "#93c978", "#6aa95c", "#b4d67c"],
    trunk: "#8b5e3c",
    skin: "#ffd9b6",
    light: {
      hemi: ["#fff3dd", "#b98a63", 1.15],
      sun: { color: "#ffe2bd", intensity: 2.4, pos: [-9, 20, 10] },
      fill: { color: "#c9dcff", intensity: 0.35, pos: [14, 8, -6] },
    },
    post: { ao: 2.2, bloom: 0.35, tiltShift: 0.06, vignette: 0.28, saturation: 0.08 },
    windowGlow: "#ffd27a",
    labelClass: "look-toy",
  },
  // B — low-poly island at dusk (Islanders / Dorfromantik): faceted, long light, lit windows
  dusk: {
    id: "dusk",
    name: "暮色低模岛",
    sky: "linear-gradient(180deg, #4b4a86 0%, #a2689a 38%, #f19a7a 70%, #ffd29a 100%)",

    terrain: "isle-water",
    shading: "faceted",
    rounded: false,
    outline: null,
    ground: { top: "#9fb35e", topDark: "#879a4d", soil: "#8c5a43", soilDark: "#5e3a2f", path: "#ecc995", plaza: "#e2bb86", water: "#5fa3b5" },
    roof: "#b84f3a",
    trim: "#f6dfc0",
    wood: "#7d5236",
    building: {
      library: { wall: "#ead2ab", accent: "#b84f3a" },
      forge: { wall: "#5d514d", accent: "#ff7a2f" },
      workshop: { wall: "#9bbf9f", accent: "#4f6e5a" },
      training: { wall: "#9fb85a", accent: "#f4efe3" },
      port: { wall: "#a67650", accent: "#5aa7bb" },
      embassy: { wall: "#efe1c8", accent: "#3f8f86" },
      council: { wall: "#d98d80", accent: "#9c4d45" },
      studio: { wall: "#b79fd6", accent: "#6e4fa6" },
      control: { wall: "#6f86a8", accent: "#2f4a72" },
    },
    hall: { wall: "#f2cf95", accent: "#b84f3a" },
    foliage: ["#6f8f3f", "#88a046", "#5d7b3a", "#a3a84f"],
    trunk: "#6b4430",
    skin: "#f5c9a2",
    light: {
      hemi: ["#b9b4ee", "#e3a072", 1.25],
      sun: { color: "#ffb47a", intensity: 2.9, pos: [-16, 13, 4] },
      fill: { color: "#9aa6f0", intensity: 0.7, pos: [12, 10, 14] },
    },
    post: { ao: 1.6, bloom: 0.9, tiltShift: 0, vignette: 0.45, saturation: 0.12 },
    windowGlow: "#ffc46b",
    labelClass: "look-dusk",
  },
  // C — sand-table blueprint (Mini Motorways): cel-shaded, clean blocks, colour is the code
  board: {
    id: "board",
    name: "沙盘蓝图",
    sky: "linear-gradient(180deg, #eef2f6 0%, #e3e9f0 100%)",
    terrain: "board",
    shading: "toon",
    rounded: true,
    outline: "#2b3440",
    ground: { top: "#fbfcfd", topDark: "#eef2f6", soil: "#d7dee7", soilDark: "#c2ccd8", path: "#e4e9f0", plaza: "#eef2f6" },
    roof: "#ffffff",
    trim: "#ffffff",
    wood: "#c9b8a3",
    building: {
      library: { wall: "#4f7cf0", accent: "#dfe8ff" },
      forge: { wall: "#9a6a3c", accent: "#ff8a3d" },
      workshop: { wall: "#f2a33a", accent: "#fff1dc" },
      training: { wall: "#1fae98", accent: "#ffffff" },
      port: { wall: "#8b5cf6", accent: "#ede6ff" },
      embassy: { wall: "#64748b", accent: "#e8edf3" },
      council: { wall: "#e2b93b", accent: "#fff6d8" },
      studio: { wall: "#e2508f", accent: "#ffe3ef" },
      control: { wall: "#0ea5c4", accent: "#dcf6fb" },
    },
    hall: { wall: "#2b3440", accent: "#ffd166" },
    foliage: ["#9ed9b5", "#b7e4c7", "#8fd0a8"],
    trunk: "#c9b8a3",
    skin: "#ffe0c7",
    light: {
      hemi: ["#ffffff", "#dfe5ec", 1.4],
      sun: { color: "#ffffff", intensity: 1.6, pos: [-8, 22, 12] },
    },
    post: { ao: 1.2, bloom: 0, tiltShift: 0, vignette: 0.12, saturation: 0 },
    windowGlow: "#ffd166",
    labelClass: "look-board",
  },
};

export function useLook(): Look {
  return LOOKS[useStore((s) => s.look)];
}
