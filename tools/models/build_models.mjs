// 거리 소품·차량 3D 모델을 받아 게임용으로 줄여 assets/models/<이름>.glb로 저장한다.
// 실행: cd tools/models && npm install && node build_models.mjs [이름,이름]
// 원본(1k glTF)은 참고자료/models_raw/에 받아 두고(저장소에 넣지 않음), 결과 .glb만 저장소에 담는다.
// 줄이는 방법: 녹·낙서 변형 부품을 빼고, 삼각형을 목표 수로 줄이고, 텍스처는 색상 지도 하나만 512px로 남긴다.
// 출처와 라이선스는 assets/models/README.md (Poly Haven은 모두 CC0)
import { mkdirSync, existsSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, dedup, weld, simplify, join as joinMeshes, flatten, textureCompress } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RAW = join(ROOT, "참고자료", "models_raw");
const OUT = join(ROOT, "assets", "models");
const UA = { "User-Agent": "sound-walk-model-builder" };

// name: 게임에서 부르는 이름, ph: Poly Haven 자산 이름, drop: 빼는 부품 이름(정규식), tris: 목표 삼각형 수,
// error: 줄일 때 허용하는 모양 오차(기본 0.01, 목표까지 안 줄어드는 모델만 크게)
export const MODELS = [
  { name: "aircon", ph: "exterior_aircon_unit", drop: /rusted/, tris: 1500 },
  { name: "utility_box", ph: "utility_box_01", tris: 1200 },
  { name: "utility_box_big", ph: "utility_box_02", tris: 1500 },
  { name: "trashbag", ph: "trashbag", tris: 900 },
  { name: "crate", ph: "plastic_crate_02", tris: 1200 },
  { name: "cardboard", ph: "cardboard_box_01", tris: 600 },
  { name: "hand_truck", ph: "hand_truck", tris: 1500, error: 0.08 },
  { name: "planter", ph: "planter_box_01", tris: 1200 },
  { name: "potted_plant", ph: "potted_plant_02", tris: 1500, error: 0.08 },
  { name: "chair", ph: "plastic_monobloc_chair_01", tris: 1200 },
  { name: "table_set", ph: "outdoor_table_chair_set_01", tris: 2000, error: 0.08 },
  { name: "hydrant", ph: "fire_hydrant", drop: /aged/, tris: 1500 },
  { name: "covered_car", ph: "covered_car", tris: 3500 },
  { name: "shutter", ph: "rollershutter_door", drop: /graffiti/, tris: 600 },
];

async function download(ph) {
  const dir = join(RAW, ph);
  const gltfPath = join(dir, ph + ".gltf");
  if (existsSync(gltfPath)) return gltfPath;
  const files = await (await fetch(`https://api.polyhaven.com/files/${ph}`, { headers: UA })).json();
  const g = files.gltf["1k"].gltf;
  mkdirSync(dir, { recursive: true });
  const get = async (url, to) => {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, Buffer.from(await res.arrayBuffer()));
  };
  for (const [rel, f] of Object.entries(g.include || {})) await get(f.url, join(dir, rel));
  await get(g.url, gltfPath);
  return gltfPath;
}

const countTris = (doc) => {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices();
    n += (idx ? idx.getCount() : p.getAttribute("POSITION").getCount()) / 3;
  }
  return Math.round(n);
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
const only = process.argv[2] ? process.argv[2].split(",") : null;
mkdirSync(OUT, { recursive: true });
for (const m of MODELS.filter((x) => !only || only.includes(x.name))) {
  const src = await download(m.ph);
  const doc = await io.read(src);
  const root = doc.getRoot();
  if (m.drop) for (const node of root.listNodes()) if (m.drop.test(node.getName())) node.dispose();
  // 색상 지도만 남긴다 (법선·거칠기·차폐 지도는 멀리서 차이가 작고 용량이 크다)
  for (const mat of root.listMaterials()) {
    mat.setNormalTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null);
    mat.setMetallicFactor(0).setRoughnessFactor(0.85);
  }
  await doc.transform(prune(), dedup(), flatten(), joinMeshes(), weld());
  const before = countTris(doc);
  if (before > m.tris) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: m.tris / before, error: m.error || 0.01 }));
  await doc.transform(prune(), textureCompress({ encoder: sharp, resize: [512, 512] }));
  const out = join(OUT, m.name + ".glb");
  await io.write(out, doc);
  console.log(`${m.name.padEnd(14)} ${m.ph.padEnd(28)} 삼각형 ${before} -> ${countTris(doc)}, ${Math.round(statSync(out).size / 1024)}KB`);
}
