# Asset licences

Third-party files distributed in `public/assets/beach/`. All are CC0 1.0
(public domain dedication); no attribution is required, it is recorded here so
the origin of every shipped byte is traceable. Sizes, triangle counts and
SHA-256 of the distributed files are in `assets/beach-manifest.json`, which
`scripts/build-beach-assets.mjs` regenerates from the sources below.

| Distributed file | Source | Author(s) | Licence | Modification |
|---|---|---|---|---|
| `textures/sand_03_{diff,nor,arm}_1k.jpg` | [Poly Haven — Sand 03](https://polyhaven.com/a/sand_03) | Charlotte Baglioni | CC0 1.0 | none (1K JPEG as published) |
| `textures/aerial_beach_01_{diff,nor}_1k.jpg` | [Poly Haven — Aerial Beach 01](https://polyhaven.com/a/aerial_beach_01) | Rob Tuytel | CC0 1.0 | none (1K JPEG as published) |
| `models/rock-block-lod{0,1}.glb`, `textures/rock-block_{color,normal,orm}_512.jpg` | [Poly Haven — Namaqualand Boulder 03](https://polyhaven.com/a/namaqualand_boulder_03) | Jenelle van Heerden, Dario Barresi | CC0 1.0 | welded, simplified (~1.3k / ~0.26k triangles), geometry-only GLB; maps resized to 512 px and shipped as separate JPEGs |
| `models/rock-slab-lod{0,1}.glb`, `textures/rock-slab_*_512.jpg` | [Poly Haven — Namaqualand Boulder 05](https://polyhaven.com/a/namaqualand_boulder_05) | Jenelle van Heerden, Dario Barresi | CC0 1.0 | as above (~1.6k / ~0.36k triangles) |
| `models/rock-round-lod{0,1}.glb`, `textures/rock-round_*_512.jpg` | [Poly Haven — Namaqualand Boulder 04](https://polyhaven.com/a/namaqualand_boulder_04) | Jenelle van Heerden | CC0 1.0 | as above (~1.2k / ~0.24k triangles) |

Not files, but worth stating: the palms, ferns, dune grass, sky, sea and sand
shading are generated at runtime by Plaza's own code (Apache-2.0). Mesh
reduction used [glTF-Transform](https://gltf-transform.dev) (MIT) at build
time only; nothing of it ships.

The rock maps are separate files on purpose: GLTFLoader reads images
embedded in a GLB through `blob:` URLs, which the static-web CSP
(`connect-src 'self'`) refuses in Chrome and Firefox.
