// 거리 소품 원본(참고자료/polyhaven/, 참고자료/models/)을 게임용 glb(assets/props/)로 정리한다. 변환 페이지는 차량과 같은 tools/convert_cars.html.
// 먼저: node tools/fetch_props.mjs, node tools/fetch_models.mjs 로 원본을 받고, 다른 터미널에서 node tools/check/serve.mjs (또는 review.mjs)를 띄운다.
// 실행: node tools/convert_props.mjs [--views]
// keep/skip: 노드 이름으로 고르기(녹슨·낙서·낡은 변형 빼기). tint: 텍스처를 빼고 한 색으로. height·length: 그 크기로 맞추기(없으면 원본 크기).
// simplify: 삼각형을 이 비율로 줄인다(gltf-transform simplify). 거리 소품은 작게 보여서 줄여도 티가 나지 않는다
// error: 단순화 오차 한도(모델 크기 대비, 기본 0.01). 비율까지 못 줄이고 멈추는 큰 소품만 올린다
import { writeFileSync, mkdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { openBrowser, sleep, ROOT, OUT as SHOTS } from "./check/browser.mjs";

const PH = (id) => ({ src: `polyhaven/${id}/${id}.gltf`, credit: `polyhaven/${id}/source.json` });
const SF = (id) => ({ src: `models/${id}/${id}.glb`, credit: `models/${id}/source.json` });
export const PROPS = {
  aircon: { ...PH("exterior_aircon_unit"), keep: "(^|/)exterior_aircon_unit(_\\d+)?(/|$)", skip: "rusted", simplify: 0.15 },
  shutter_door: { ...PH("rollershutter_door"), keep: "^rollershutter_door(/|$)" },
  shutter_window: { ...PH("rollershutter_window_01"), keep: "^rollershutter_window_01(/|$)" },
  chair: { ...PH("plastic_monobloc_chair_01"), simplify: 0.35 },
  cafe_set: { ...PH("outdoor_table_chair_set_01"), simplify: 0.12 },
  crate: { ...PH("plastic_crate_02"), simplify: 0.3 },
  box: { ...PH("cardboard_box_01"), simplify: 0.08 },
  hand_truck: { ...PH("hand_truck"), simplify: 0.12 },
  plant: { ...PH("potted_plant_02"), simplify: 0.05, error: 0.04 },
  planter: { ...PH("planter_box_01"), simplify: 0.3 },
  pole_a: { ...PH("modular_electricity_poles"), keep: "(^|/)preset_01_", height: 9, simplify: 0.07, error: 0.03, tint: [{ mat: "poles$", color: "#a3a39d", roughness: 0.9 }] }, // 변압기 달린 전봇대
  pole_b: { ...PH("modular_electricity_poles"), keep: "(^|/)preset_02_", height: 9, simplify: 0.07, error: 0.03, tint: [{ mat: "poles$", color: "#a3a39d", roughness: 0.9 }] },
  utility_box_a: { ...PH("utility_box_01"), simplify: 0.5 },
  utility_box_b: { ...PH("utility_box_02"), simplify: 0.5 },
  hydrant: { ...PH("fire_hydrant"), keep: "(^|/)fire_hydrant(_cap_01|_chain)?(_\\d+)?(/|$)", skip: "aged", simplify: 0.05 },
  trashbag: { ...PH("trashbag"), simplify: 0.4, tint: [{ mat: ".", color: "#ece9dc", roughness: 0.45 }] }, // 흰 종량제 봉투
  bicycle: { ...SF("bicycle"), length: 1.75, simplify: 0.12 },
  bike_stand: { ...SF("bikestand"), length: 2.2, yaw: Math.PI / 2, simplify: 0.2 },
  scooter: { ...SF("scooter"), length: 1.15, yaw: Math.PI / 2, simplify: 0.12 },
  cone: { ...SF("cones"), keep: "Traffic_Cone_1_1", height: 0.72 },
  bollard: { ...SF("cones"), keep: "Bollard_1", height: 0.9 },
};

const VIEWS = process.argv.includes("--views");
const OUT = join(ROOT, "assets", "props");
const HOST = (process.env.APP_URL || "http://127.0.0.1:8765/index.html").replace(/\/index\.html$/, "");
const b = await openBrowser(9416);
await b.send("Page.navigate", { url: `${HOST}/tools/convert_cars.html` });
for (let i = 0; i < 40 && !(await b.ev("typeof window.prepare === 'function' && typeof THREE.GLTFExporter === 'function'")); i++) await sleep(500);
mkdirSync(OUT, { recursive: true });
let total = 0;
for (const [name, spec] of Object.entries(PROPS)) {
  if (!existsSync(join(ROOT, "참고자료", spec.src))) { console.log("원본 없음", name); continue; }
  const url = encodeURI(`/참고자료/${spec.src}`);
  const r = await b.ev(`prepare(${JSON.stringify({ ...spec, url, tex: 512 })}).then(r => JSON.stringify(r)).catch(e => "ERR " + e.message)`);
  if (!r || r.startsWith("ERR")) { console.log("실패", name, r); continue; }
  const { info, views } = JSON.parse(r);
  for (const [v, data] of Object.entries(views)) writeFileSync(join(SHOTS, `props-${name}-${v}.png`), Buffer.from(data.split(",")[1], "base64"));
  let line = `${name.padEnd(15)} 크기 ${info.size.join(" × ")}m · 삼각형 ${Math.round(info.tris)} · 재질 ${info.materials.length}개`;
  if (!VIEWS) {
    const file = join(OUT, name + ".glb");
    writeFileSync(file, Buffer.from(await b.ev("exportLast()"), "base64"));
    const steps = [["weld"], ...(spec.simplify ? [["simplify", "--ratio", String(spec.simplify), "--error", String(spec.error || 0.01)]] : []), ["quantize"], ["dedup"], ["prune"]];
    for (const [step, ...args] of steps) execFileSync("npx", ["-y", "@gltf-transform/cli@4.1.1", step, file, file, ...args], { stdio: "ignore" });
    const src = JSON.parse(readFileSync(join(ROOT, "참고자료", spec.credit), "utf8"));
    writeFileSync(join(OUT, name + ".json"), JSON.stringify({ name: src.name, author: src.author || (src.authors || []).join(", "), url: src.url, license: src.license }, null, 1));
    total += statSync(file).size;
    line += ` → ${(statSync(file).size / 1e6).toFixed(2)}MB`;
  }
  console.log(line);
}
b.close();
console.log(`합계 ${(total / 1e6).toFixed(1)}MB · 확인용 사진: ${SHOTS}/props-*.png`);
