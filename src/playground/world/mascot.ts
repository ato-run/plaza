/**
 * Local animal NPCs.
 *
 * They exist so that arriving alone is not arriving in an empty 3D box. A
 * plaza with nobody in it reads as broken rather than quiet, and the first
 * thing a new visitor sees decides whether they wait around long enough for a
 * real person to show up.
 *
 * They are LOCAL and they are not people:
 *   - never sent over the wire, never in presence, never in the online count;
 *   - built by the World, disposed with the World;
 *   - what they say is a canned local line, so a mascot cannot be mistaken
 *     for somebody who is actually listening.
 *
 * The count matters: a couple reads as a quiet square, a dozen reads as a
 * zoo you cannot talk to. Three to five per World.
 */
import * as THREE from "three";

import type { WorldBuilder } from "./primitives";

export type MascotSpecies =
  | "cat"
  | "dog"
  | "panda"
  | "fox"
  | "penguin"
  | "rabbit"
  | "bird";

interface SpeciesLook {
  emoji: string;
  body: string;
  accent: string;
  belly: string;
  /** Upright animals (penguin, bird) stand rather than going on all fours. */
  upright?: boolean;
  ears: "pointed" | "round" | "long" | "none";
}

const LOOKS: Record<MascotSpecies, SpeciesLook> = {
  cat: { emoji: "🐱", body: "#b9a48d", accent: "#8f7b66", belly: "#e6dccd", ears: "pointed" },
  dog: { emoji: "🐶", body: "#c99a63", accent: "#a67846", belly: "#efe2cf", ears: "round" },
  panda: { emoji: "🐼", body: "#f0efe9", accent: "#3b3b3b", belly: "#ffffff", ears: "round" },
  fox: { emoji: "🦊", body: "#d08048", accent: "#a75c2e", belly: "#f5e7d8", ears: "pointed" },
  penguin: { emoji: "🐧", body: "#3a4550", accent: "#22282f", belly: "#f2f1e7", upright: true, ears: "none" },
  rabbit: { emoji: "🐰", body: "#dcd6cd", accent: "#b9b0a4", belly: "#f7f3ec", ears: "long" },
  bird: { emoji: "🐦", body: "#6f9fb5", accent: "#3f6d83", belly: "#eef4f2", upright: true, ears: "none" },
};

export interface Mascot {
  id: string;
  name: string;
  species: MascotSpecies;
  group: THREE.Group;
  head: THREE.Group;
  tail: THREE.Object3D | null;
  label: HTMLDivElement;
  bubble: HTMLDivElement;
  /** Where the crosshair must be centred — its head. */
  anchor: THREE.Vector3;
  /** Local lines, cycled on interaction. */
  lines: string[];
  spokenUntil: number;
  lineIndex: number;
  /** Phase offset so a group of them does not breathe in unison. */
  phase: number;
  baseY: number;
}

export interface MascotSpec {
  id: string;
  name: string;
  species: MascotSpecies;
  x: number;
  z: number;
  yaw?: number;
  lines?: string[];
}

const DEFAULT_LINES: Record<MascotSpecies, string[]> = {
  cat: ["ここはみんなの広場だよ。", "ベンチ、あたたかいよ。"],
  dog: ["やあ！ 誰か来るのを待ってるんだ。", "走り回ってもいいよ。"],
  panda: ["向こうに置いてあるの、遊べるよ。", "のんびりしていってね。"],
  fox: ["いい店が並んでるよ。", "見て回ってみて。"],
  penguin: ["風がつめたいね。", "遠くまで見えるよ。"],
  rabbit: ["草がやわらかいよ。", "どこまでも走れそう。"],
  bird: ["上から見てるよ。", "静かな夜だね。"],
};

/**
 * Build one animal.
 *
 * Same voxel vocabulary as the human avatar so the two read as inhabitants of
 * one world; the silhouette differs (four legs and a tail, or an upright body
 * with flippers) so a mascot is never mistaken for a person at a distance.
 */
export function createMascot(
  builder: WorldBuilder,
  labelHost: HTMLElement,
  spec: MascotSpec,
): Mascot {
  const look = LOOKS[spec.species];
  const group = builder.group();
  group.position.set(spec.x, 0, spec.z);
  group.rotation.y = spec.yaw ?? 0;

  const head = new THREE.Group();
  let tail: THREE.Object3D | null = null;

  if (look.upright) {
    builder.box(0.46, 0.62, 0.36, look.body, 0, 0.55, 0, group);
    builder.box(0.3, 0.42, 0.06, look.belly, 0, 0.55, 0.17, group);
    builder.box(0.12, 0.34, 0.12, look.accent, -0.28, 0.56, 0, group);
    builder.box(0.12, 0.34, 0.12, look.accent, 0.28, 0.56, 0, group);
    builder.box(0.16, 0.08, 0.24, look.accent, -0.12, 0.04, 0.06, group);
    builder.box(0.16, 0.08, 0.24, look.accent, 0.12, 0.04, 0.06, group);
    head.position.y = 1.0;
  } else {
    builder.box(0.66, 0.42, 0.36, look.body, 0, 0.5, 0, group);
    builder.box(0.5, 0.16, 0.3, look.belly, 0, 0.33, 0, group);
    for (const [lx, lz] of [
      [-0.22, 0.13],
      [0.22, 0.13],
      [-0.22, -0.13],
      [0.22, -0.13],
    ]) {
      builder.box(0.13, 0.32, 0.13, look.accent, lx, 0.16, lz, group);
    }
    tail = builder.box(0.1, 0.1, 0.42, look.accent, 0, 0.6, -0.35, group);
    head.position.set(0, 0.72, 0.3);
  }
  group.add(head);

  builder.box(0.36, 0.34, 0.32, look.body, 0, 0, 0, head);
  builder.box(0.16, 0.12, 0.1, look.belly, 0, -0.06, 0.19, head);
  builder.box(0.05, 0.05, 0.02, "#2c3330", -0.09, 0.04, 0.165, head);
  builder.box(0.05, 0.05, 0.02, "#2c3330", 0.09, 0.04, 0.165, head);

  if (look.ears === "pointed") {
    builder.box(0.11, 0.16, 0.05, look.accent, -0.11, 0.22, 0, head);
    builder.box(0.11, 0.16, 0.05, look.accent, 0.11, 0.22, 0, head);
  } else if (look.ears === "round") {
    builder.box(0.13, 0.13, 0.07, look.accent, -0.14, 0.2, 0, head);
    builder.box(0.13, 0.13, 0.07, look.accent, 0.14, 0.2, 0, head);
  } else if (look.ears === "long") {
    builder.box(0.09, 0.34, 0.06, look.accent, -0.09, 0.32, 0, head);
    builder.box(0.09, 0.34, 0.06, look.accent, 0.09, 0.32, 0, head);
  }

  const label = document.createElement("div");
  label.className = "pg-label";
  const bubble = document.createElement("div");
  bubble.className = "pg-speech";
  bubble.style.display = "none";
  const nameTag = document.createElement("div");
  nameTag.className = "pg-nametag pg-nametag--mascot";
  nameTag.textContent = `${look.emoji} ${spec.name}`;
  label.append(bubble, nameTag);
  labelHost.append(label);

  const baseY = look.upright ? 1.35 : 1.15;

  return {
    id: spec.id,
    name: spec.name,
    species: spec.species,
    group,
    head,
    tail,
    label,
    bubble,
    anchor: new THREE.Vector3(spec.x, look.upright ? 1.05 : 0.78, spec.z),
    lines: spec.lines ?? DEFAULT_LINES[spec.species],
    spokenUntil: 0,
    lineIndex: 0,
    phase: (spec.x * 7.3 + spec.z * 3.1) % (Math.PI * 2),
    baseY,
  };
}

/** Breathing, a tail, and the occasional look around. Cheap and alive. */
export function animateMascot(
  mascot: Mascot,
  now: number,
  reducedMotion: boolean,
): void {
  if (reducedMotion) {
    mascot.group.position.y = 0;
    mascot.head.rotation.y = 0;
    if (mascot.tail) mascot.tail.rotation.y = 0;
    return;
  }
  const t = now * 0.001 + mascot.phase;
  mascot.group.position.y = Math.sin(t * 1.6) * 0.012;
  // A slow sweep, not a metronome: two sines with unrelated periods never
  // quite repeat, so it does not read as a loop.
  mascot.head.rotation.y = Math.sin(t * 0.37) * 0.34 + Math.sin(t * 0.11) * 0.16;
  if (mascot.tail) mascot.tail.rotation.y = Math.sin(t * 2.4) * 0.28;
}

/** Say the next canned line. Local only — nothing leaves the browser. */
export function speakMascot(mascot: Mascot, now: number, durationMs = 5200): void {
  const line = mascot.lines[mascot.lineIndex % mascot.lines.length] ?? "";
  mascot.lineIndex += 1;
  mascot.bubble.textContent = line;
  mascot.spokenUntil = now + durationMs;
}

export function updateMascotBubble(mascot: Mascot, now: number): void {
  mascot.bubble.style.display = now < mascot.spokenUntil ? "block" : "none";
}

export function disposeMascot(mascot: Mascot): void {
  // Geometry/material belong to the World's builder, which disposes them with
  // the rest of the World; the DOM label is this module's to remove.
  mascot.label.remove();
}
