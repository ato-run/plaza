/**
 * The parts Worlds are made of, and the bookkeeping that lets them be thrown
 * away cleanly.
 *
 * Disposal is the whole reason this is a factory rather than a pile of
 * functions. three.js frees GPU memory only when `dispose()` is called on each
 * geometry, material and texture; dropping the objects does nothing. A leak
 * here is invisible until the fourth or fifth World switch on a phone, and
 * then it is a crash rather than a slowdown — the worst possible failure to
 * debug after the fact. So every mesh, material and texture a World creates is
 * created THROUGH this builder, which remembers them and disposes them by
 * identity (shared materials exist, and disposing one twice is a silent
 * corruption).
 *
 * Geometry and material caching is by value: a plaza has ~150 boxes across a
 * handful of sizes and colours, and building 150 separate `MeshStandardMaterial`
 * instances for eight distinct colours costs eight times the shader compiles
 * for no visual difference.
 */
import * as THREE from "three";

export interface WorldBuilder {
  /** Everything ends up parented here, directly or indirectly. */
  readonly root: THREE.Group;
  box(
    width: number,
    height: number,
    depth: number,
    color: string,
    x: number,
    y: number,
    z: number,
    parent?: THREE.Object3D,
  ): THREE.Mesh;
  cylinder(
    radius: number,
    height: number,
    color: string,
    x: number,
    y: number,
    z: number,
    segments?: number,
    parent?: THREE.Object3D,
  ): THREE.Mesh;
  /** A faceted blob — foliage, bushes, rocks. */
  blob(
    radius: number,
    color: string,
    x: number,
    y: number,
    z: number,
    detail?: number,
    parent?: THREE.Object3D,
  ): THREE.Mesh;
  /** Register something built by hand so it is still disposed. */
  track<T extends THREE.Object3D>(object: T, parent?: THREE.Object3D): T;
  /** Register a resource the builder did not create (canvas textures). */
  trackResource(resource: { dispose(): void }): void;
  group(parent?: THREE.Object3D): THREE.Group;
  /** A material from the shared cache — for hand-built meshes. */
  material(color: string, options?: MaterialOptions): THREE.Material;
  dispose(): void;
}

interface MaterialOptions {
  transparent?: boolean;
  opacity?: number;
  roughness?: number;
  /** Unlit — for water, glows, and anything that should not take shadow. */
  basic?: boolean;
  emissive?: string;
}

function materialKey(color: string, options: MaterialOptions): string {
  return [
    color,
    options.basic ? "basic" : "standard",
    options.transparent ? "t" : "",
    options.opacity ?? 1,
    options.roughness ?? 0.92,
    options.emissive ?? "",
  ].join("|");
}

export function createWorldBuilder(root: THREE.Group): WorldBuilder {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Map<string, THREE.Material>();
  const resources = new Set<{ dispose(): void }>();
  const geometryCache = new Map<string, THREE.BufferGeometry>();

  const geometry = <T extends THREE.BufferGeometry>(key: string, make: () => T): T => {
    const cached = geometryCache.get(key);
    if (cached) return cached as T;
    const created = make();
    geometryCache.set(key, created);
    geometries.add(created);
    return created;
  };

  const material = (color: string, options: MaterialOptions = {}): THREE.Material => {
    const key = materialKey(color, options);
    const cached = materials.get(key);
    if (cached) return cached;
    const created = options.basic
      ? new THREE.MeshBasicMaterial({
          color,
          transparent: options.transparent ?? false,
          opacity: options.opacity ?? 1,
        })
      : new THREE.MeshStandardMaterial({
          color,
          roughness: options.roughness ?? 0.92,
          transparent: options.transparent ?? false,
          opacity: options.opacity ?? 1,
          ...(options.emissive ? { emissive: new THREE.Color(options.emissive) } : {}),
        });
    materials.set(key, created);
    return created;
  };

  const mesh = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D,
  ): THREE.Mesh => {
    const created = new THREE.Mesh(geo, mat);
    created.position.set(x, y, z);
    created.castShadow = true;
    created.receiveShadow = true;
    parent.add(created);
    return created;
  };

  return {
    root,

    box(width, height, depth, color, x, y, z, parent = root) {
      return mesh(
        geometry(`box:${width}:${height}:${depth}`, () =>
          new THREE.BoxGeometry(width, height, depth),
        ),
        material(color),
        x,
        y,
        z,
        parent,
      );
    },

    cylinder(radius, height, color, x, y, z, segments = 32, parent = root) {
      return mesh(
        geometry(`cyl:${radius}:${height}:${segments}`, () =>
          new THREE.CylinderGeometry(radius, radius, height, segments),
        ),
        material(color),
        x,
        y,
        z,
        parent,
      );
    },

    blob(radius, color, x, y, z, detail = 0, parent = root) {
      return mesh(
        geometry(`ico:${radius}:${detail}`, () =>
          new THREE.IcosahedronGeometry(radius, detail),
        ),
        material(color),
        x,
        y,
        z,
        parent,
      );
    },

    track(object, parent = root) {
      parent.add(object);
      return object;
    },

    trackResource(resource) {
      resources.add(resource);
    },

    group(parent = root) {
      const created = new THREE.Group();
      parent.add(created);
      return created;
    },

    material,

    dispose() {
      // Sweep the subtree first: it catches anything built by hand and merely
      // `track`ed, whose geometry/material the caches never saw.
      root.traverse((object) => {
        const withGeometry = object as Partial<THREE.Mesh>;
        if (withGeometry.geometry) geometries.add(withGeometry.geometry);
        const withMaterial = (object as Partial<THREE.Mesh>).material;
        if (withMaterial) {
          const list = Array.isArray(withMaterial) ? withMaterial : [withMaterial];
          for (const entry of list) {
            // Textures a material owns are not freed by the material itself.
            for (const value of Object.values(entry as unknown as Record<string, unknown>)) {
              if (value instanceof THREE.Texture) resources.add(value);
            }
            materials.set(`sweep:${entry.uuid}`, entry);
          }
        }
      });
      root.removeFromParent();
      root.clear();
      for (const entry of geometries) entry.dispose();
      for (const entry of materials.values()) entry.dispose();
      for (const entry of resources) entry.dispose();
      geometries.clear();
      materials.clear();
      resources.clear();
      geometryCache.clear();
    },
  };
}

/**
 * A tree: trunk, crown, and a smaller offset crown so it is not a lollipop.
 * Returns the collider the trunk should have.
 */
export function tree(
  builder: WorldBuilder,
  x: number,
  z: number,
  scale = 1,
  palette: { trunk?: string; crown?: string; highlight?: string } = {},
): void {
  const trunk = palette.trunk ?? "#907a61";
  const crown = palette.crown ?? "#709565";
  const highlight = palette.highlight ?? "#93ad76";
  builder.box(0.27 * scale, 2.1 * scale, 0.27 * scale, trunk, x, 1.05 * scale, z);
  const canopy = builder.blob(1.4 * scale, crown, x, 2.6 * scale, z);
  canopy.scale.y = 1.25;
  builder.blob(0.9 * scale, highlight, x + 0.5 * scale, 3.3 * scale, z);
}

/** A bench facing +Z, with a back and two legs. */
export function bench(
  builder: WorldBuilder,
  x: number,
  z: number,
  rotation = 0,
): void {
  const group = builder.group();
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  builder.box(2.9, 0.16, 0.7, "#ae8863", 0, 0.58, 0, group);
  builder.box(2.9, 0.45, 0.12, "#bb9975", 0, 0.94, -0.32, group);
  builder.box(0.14, 0.5, 0.55, "#4d6458", -1, 0.27, 0, group);
  builder.box(0.14, 0.5, 0.55, "#4d6458", 1, 0.27, 0, group);
}

/** A raised planter with a hedge in it. */
export function planter(builder: WorldBuilder, x: number, z: number): void {
  builder.box(3, 0.55, 1.3, "#a9b39e", x, 0.27, z);
  builder.box(2.8, 0.12, 1.1, "#547b50", x, 0.57, z);
  for (let i = 0; i < 6; i += 1) {
    builder.blob(0.42, i % 2 ? "#7c9d60" : "#547e50", x - 1.1 + i * 0.43, 0.85, z);
  }
}

/**
 * A lamp post with an unlit glowing head.
 *
 * Deliberately NOT a PointLight. Lights are the one thing in a scene whose
 * cost is per-fragment rather than per-object; a dozen of them turns a plaza
 * that runs on a phone into one that does not. An emissive box reads as "lit"
 * at this art style's fidelity.
 */
export function lantern(
  builder: WorldBuilder,
  x: number,
  z: number,
  color = "#ffe9b8",
  height = 3.1,
): void {
  builder.box(0.16, height, 0.16, "#4d5b52", x, height / 2, z);
  const head = builder.box(0.42, 0.5, 0.42, color, x, height + 0.1, z);
  (head.material as THREE.MeshStandardMaterial).emissive?.set(color);
  head.castShadow = false;
}
