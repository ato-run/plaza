import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { createWorldBuilder } from "./primitives";

function countDisposals(resource: THREE.EventDispatcher<{ dispose: object }>): () => number {
  let count = 0;
  resource.addEventListener("dispose", () => {
    count += 1;
  });
  return () => count;
}

describe("world builder disposal", () => {
  it("releases a cached material once, however many meshes found it", () => {
    const builder = createWorldBuilder(new THREE.Group());
    const first = builder.box(1, 1, 1, "#ffffff", 0, 0, 0);
    builder.box(2, 2, 2, "#ffffff", 0, 0, 0);
    const material = first.material as THREE.Material;
    const disposed = countDisposals(material);
    builder.dispose();
    expect(disposed()).toBe(1);
  });

  it("releases explicitly registered uniform textures and depth materials", () => {
    const builder = createWorldBuilder(new THREE.Group());
    const uniformTexture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    builder.trackResource(uniformTexture);
    const mesh = builder.track(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial();
    const texture = countDisposals(uniformTexture);
    const depth = countDisposals(mesh.customDepthMaterial);
    builder.dispose();
    expect(texture()).toBe(1);
    expect(depth()).toBe(1);
  });

  it("leaves a render target's texture to the render target", () => {
    const builder = createWorldBuilder(new THREE.Group());
    const target = new THREE.WebGLRenderTarget(4, 4);
    builder.track(
      new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ map: target.texture })),
    );
    const texture = countDisposals(target.texture);
    builder.dispose();
    expect(texture()).toBe(0);
    target.dispose();
  });

  it("frees instance buffers of instanced meshes", () => {
    const builder = createWorldBuilder(new THREE.Group());
    const instanced = builder.track(
      new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 4),
    );
    const disposed = countDisposals(instanced as unknown as THREE.EventDispatcher<{ dispose: object }>);
    builder.dispose();
    expect(disposed()).toBe(1);
  });
});
