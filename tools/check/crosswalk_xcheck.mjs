// 공공데이터 횡단보도와 규칙 횡단보도(큰길 교차로)를 지역별로 비교한다 (교차검증 표를 다시 만들 때 쓴다)
// 먼저 원본을 받는다: node tools/fetch_public.mjs
// 실행: node tools/check/crosswalk_xcheck.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readShapefile, tmFromPrj } from "../shapefile.mjs";
import { ROOT } from "./browser.mjs";

const SRC = { seoul: "seoul_crosswalk/A004_A", daegu: "daegu_crosswalk/A0043325" };
const cache = {};
function load(city) {
  if (cache[city]) return cache[city];
  const s = readShapefile(join(ROOT, "참고자료", "공공데이터", SRC[city]));
  const toLL = tmFromPrj(s.prj);
  return (cache[city] = s.features.filter((f) => f.geom && f.geom.rings).map((f) => {
    const r = f.geom.rings[0].map(([x, y]) => toLL(x, y));
    return [r.reduce((a, p) => a + p[0], 0) / r.length, r.reduce((a, p) => a + p[1], 0) / r.length];
  }));
}
console.log("지역\t공공 횡단보도\t큰길 교차로\t그중 공공 횡단보도 35m 안\t규칙으로 남긴 곳");
for (const { id, name, city } of JSON.parse(readFileSync(join(ROOT, "data/regions.json"), "utf8"))) {
  const d = JSON.parse(readFileSync(join(ROOT, "data", id + ".json"), "utf8"));
  const [lat0, lon0] = d.center, half = d.size / 2, mx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const inMap = ([x, z]) => x > 0 && z > 0 && x < d.size && z < d.size;
  const pub = load(city).map(([lon, lat]) => [(lon - lon0) * mx + half, -(lat - lat0) * 110540 + half]).filter(inMap);
  const key = (p) => p[0].toFixed(1) + "," + p[1].toFixed(1);
  const use = new Map();
  for (const r of d.scenery.roads) if (r.k === "car" && r.w >= 5) for (const p of r.p) {
    const e = use.get(key(p)) || { n: 0, w: 0, p }; e.n++; e.w = Math.max(e.w, r.w); use.set(key(p), e);
  }
  const wideJ = [...use.values()].filter((e) => e.n >= 2 && e.w >= 10).map((e) => e.p).filter(inMap);
  const hit = wideJ.filter((p) => pub.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 35)).length;
  const c = (d.sources && d.sources.crosswalkCounts) || {};
  console.log(`${name}\t${pub.length}\t${wideJ.length}\t${hit} (${Math.round((100 * hit) / Math.max(1, wideJ.length))}%)\t교차로 ${c.ruleJunctions ?? "?"}, 띠 ${c.ruleCrossings ?? "?"}`);
}
