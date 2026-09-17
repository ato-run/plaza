/**
 * How a piece of Software appears inside a World.
 *
 * The split that matters: a World owns the FURNITURE (where a plinth stands,
 * which way a stall faces), and the server owns the CONTENT (which App is
 * public and usable right now). So a World declares slots, and this module
 * fills a slot with whatever card the server currently projects into it. A
 * card that stops being public stops having a plinth, without the World
 * knowing anything about it.
 *
 * The title is drawn into a canvas texture rather than shown as a DOM label
 * because it belongs to the world — it should be occluded by trees, shrink
 * with distance and sit at an angle, none of which an overlay does.
 */
import * as THREE from "three";

/** Where a World is willing to put Software, and how it should look there. */
export interface SoftwareSlot {
  id: string;
  x: number;
  z: number;
  /** Radians about +Y. 0 faces +Z, toward a plaza's centre. */
  rotation?: number;
  presentation?: "plinth" | "stall";
}

export interface ExhibitCard {
  ref: string;
  kind: "app" | "activity";
  title: string;
  subtitle: string;
}

export interface Exhibit {
  ref: string;
  kind: "app" | "activity";
  title: string;
  slotId: string;
  /** The point the crosshair must be centred on. */
  anchor: THREE.Vector3;
  dispose(): void;
}

/** The radius an exhibit blocks, so nobody walks through a plinth. */
export { EXHIBIT_OBSTACLE_RADIUS } from "./worlds/centralGeometry";

function boardTexture(card: ExhibitCard, index: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 700;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#f0f0df";
    ctx.fillRect(0, 0, 1024, 700);
    ctx.fillStyle = "#365a45";
    ctx.font = "600 28px Arial";
    ctx.fillText(card.kind === "app" ? "SOFTWARE" : "ACTIVITY", 65, 80);
    ctx.font = "bold 96px Arial";
    // Long names must not run off the plinth.
    const title =
      card.title.length > 14 ? `${card.title.slice(0, 13)}…` : card.title;
    ctx.fillText(title, 60, 226);
    ctx.font = "26px Arial";
    ctx.fillStyle = "#567357";
    ctx.fillText(card.subtitle.slice(0, 48), 65, 292);
    ctx.font = "24px Arial";
    ctx.fillText(
      `${card.kind === "app" ? "SOFTWARE" : "ACTIVITY"}  /  ${String(index + 1).padStart(2, "0")}`,
      65,
      643,
    );
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Put `card` in `slot`.
 *
 * Parented to a group at the slot's transform so a stall can face down a
 * market aisle without every child needing its own rotated coordinates.
 */
export function addExhibit(
  parent: THREE.Object3D,
  slot: SoftwareSlot,
  index: number,
  card: ExhibitCard,
): Exhibit {
  const created: THREE.Object3D[] = [];
  const textures: THREE.Texture[] = [];

  const group = new THREE.Group();
  group.position.set(slot.x, 0, slot.z);
  group.rotation.y = slot.rotation ?? 0;
  parent.add(group);
  created.push(group);

  const texture = boardTexture(card, index);
  textures.push(texture);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(3.5, 2.4),
    new THREE.MeshBasicMaterial({ map: texture }),
  );
  screen.position.set(0, 2.15, 0.1);
  group.add(screen);

  const solid = (
    w: number,
    h: number,
    d: number,
    color: string,
    px: number,
    py: number,
    pz: number,
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.92 }),
    );
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  solid(3.68, 2.58, 0.2, "#577465", 0, 2.15, -0.04);
  solid(0.16, 1.1, 0.16, "#577465", -1.2, 0.56, -0.05);
  solid(0.16, 1.1, 0.16, "#577465", 1.2, 0.56, -0.05);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 2.4, 0.17, 32),
    new THREE.MeshStandardMaterial({ color: "#c5d1bc", roughness: 0.92 }),
  );
  base.position.set(0, 0.1, 0);
  base.receiveShadow = true;
  group.add(base);

  // The anchor is in WORLD space: targeting compares it against the camera,
  // which knows nothing about the slot's local frame.
  const anchor = new THREE.Vector3(0, 2, 0);
  group.localToWorld(anchor);

  return {
    ref: card.ref,
    kind: card.kind,
    title: card.title,
    slotId: slot.id,
    anchor,
    dispose() {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      for (const object of created) object.removeFromParent();
      textures.forEach((entry) => entry.dispose());
    },
  };
}
