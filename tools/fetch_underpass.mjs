// 지하도로 건너는 교차로의 지하철 출구 위치를 OSM(railway=subway_entrance)에서 받아 data/underpass.json에 쓴다.
// 반월당 교차로는 실제로 횡단보도가 없고 지하 대합실·지하상가로 건넌다. 게임에서는 출구로 들어가 다른 출구를 골라 나온다(js/underpass.js).
// 실행: node tools/fetch_underpass.mjs   (지도 좌표 변환은 tools/build_maps.mjs와 같다)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
// 지역마다: 교차로 가운데(지도 좌표 m)와, 그 가운데에서 이 거리(m) 안의 출구만 쓴다 (교차로 네 모서리를 잇는 출구)
const PLACES = [{ region: "banwoldang", station: "반월당역", center: [415, 410], radius: 100 }];

async function overpass(query) {
  for (const url of ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]) {
    try {
      const res = await fetch(url, { method: "POST", signal: AbortSignal.timeout(90000),
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "sound-walk-map-builder" }, body: "data=" + encodeURIComponent(query) });
      const text = await res.text();
      if (res.ok && text.trimStart().startsWith("{")) return JSON.parse(text);
    } catch (e) { /* 다음 서버 */ }
  }
  throw new Error("Overpass 서버에서 받지 못했습니다");
}

const out = {};
for (const p of PLACES) {
  const d = JSON.parse(readFileSync(join(ROOT, "data", p.region + ".json"), "utf8"));
  const [lat0, lon0] = d.center, half = d.size / 2, mx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const toXZ = (q) => [Math.round(((q.lon - lon0) * mx + half) * 10) / 10, Math.round((-(q.lat - lat0) * 110540 + half) * 10) / 10];
  const res = await overpass(`[out:json][timeout:60];node(around:400,${lat0},${lon0})[railway=subway_entrance];out;`);
  const exits = [];
  for (const e of res.elements) {
    const [x, z] = toXZ(e);
    if (Math.hypot(x - p.center[0], z - p.center[1]) > p.radius) continue;
    const no = (e.tags.ref || (e.tags.description || "").match(/(\d+)번/)?.[1] || "").trim();
    exits.push({ no, x, z, osm: e.id });
  }
  exits.sort((a, b) => Number(a.no) - Number(b.no));
  out[p.region] = { station: p.station, center: p.center, exits, source: "OpenStreetMap railway=subway_entrance (ODbL)", at: new Date().toISOString().slice(0, 10) };
  console.log(p.region, p.station, "출구", exits.map((e) => e.no).join(", "));
}
writeFileSync(join(ROOT, "data", "underpass.json"), JSON.stringify(out, null, 1) + "\n");
