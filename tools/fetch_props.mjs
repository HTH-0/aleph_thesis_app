// 거리 소품 원본(Poly Haven, CC0)을 공식 API로 참고자료/polyhaven/<이름>/에 받는다 (1k 텍스처 glTF). 원본은 저장소에 넣지 않는다.
// 실행: node tools/fetch_props.mjs
// 게임용 변환은 tools/convert_props.mjs가 한다. 고른 기준은 진행.md "맥북 세션 결정"(깨끗한 일상 소품, 낙서·녹 변형은 빼기).
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "참고자료", "polyhaven");
export const PROPS = ["exterior_aircon_unit", "rollershutter_door", "rollershutter_window_01", "plastic_monobloc_chair_01", "outdoor_table_chair_set_01",
  "plastic_crate_02", "cardboard_box_01", "hand_truck", "potted_plant_02", "planter_box_01", "modular_electricity_poles", "utility_box_01",
  "utility_box_02", "fire_hydrant", "trashbag", "modular_street_seating"];

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const UA = { "User-Agent": "sound-walk-props" };
  for (const id of PROPS) {
    const info = await (await fetch(`https://api.polyhaven.com/info/${id}`, { headers: UA })).json();
    const files = await (await fetch(`https://api.polyhaven.com/files/${id}`, { headers: UA })).json();
    const g = files.gltf && (files.gltf["1k"] || files.gltf["2k"]);
    if (!g) { console.log("glTF 없음", id); continue; }
    const dir = join(OUT, id), list = [[g.gltf.url, `${id}.gltf`], ...Object.entries(g.gltf.include || {}).map(([p, f]) => [f.url, p])];
    let bytes = 0;
    for (const [url, rel] of list) {
      const dest = join(dir, rel);
      if (existsSync(dest)) continue;
      const buf = Buffer.from(await (await fetch(url, { headers: UA })).arrayBuffer());
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, buf);
      bytes += buf.length;
    }
    writeFileSync(join(dir, "source.json"), JSON.stringify({ name: info.name, authors: Object.keys(info.authors || {}), url: `https://polyhaven.com/a/${id}`, license: "CC0", polycount: info.polycount }, null, 1));
    console.log(`${id.padEnd(28)} ${(bytes / 1e6).toFixed(1)}MB · ${Object.keys(info.authors || {}).join(", ")}`);
  }
}
