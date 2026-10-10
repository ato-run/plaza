import * as THREE from "three";
import type { WorldBuilder } from "../primitives";
/** One coarse mineral finish for authored shore geometry; no extra texture download. */
export function coastalStone(
  builder: WorldBuilder,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: "#aaa18e",
    roughness: 0.94,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vStonePoint;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvStonePoint=position;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vStonePoint;",
      )
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\nfloat grain=sin(dot(vStonePoint,vec3(19.1,27.4,13.7)))*sin(dot(vStonePoint,vec3(7.4,9.1,11.3)));\nfloat strata=sin(vStonePoint.y*21.0+sin(vStonePoint.x*2.0))*.025;\ndiffuseColor.rgb*=.94+grain*.07+strata;",
      );
  };
  material.customProgramCacheKey = () => "plaza-coastal-stone-1";
  builder.trackResource(material);
  return material;
}
export function stoneBlock(
  builder: WorldBuilder,
  material: THREE.Material,
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -height / 2);
  shape.lineTo(width / 2, -height / 2);
  shape.lineTo(width / 2, height / 2);
  shape.lineTo(-width / 2, height / 2);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.05, depth - 0.08),
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 1,
    steps: 1,
    curveSegments: 1,
  });
  geo.translate(0, 0, -depth / 2 + 0.04);
  const mesh = builder.track(new THREE.Mesh(geo, material));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
