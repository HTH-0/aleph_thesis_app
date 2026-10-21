// 고가 모노레일(대구 도시철도 3호선 하늘열차) 선로와 역 위치를 OSM에서 받아 data/rail.json에 쓴다. 게임은 js/landmarks.js가 기둥·선로·역을 그린다.
// 실행: node tools/fetch_rail.mjs   (지도 좌표 변환은 tools/build_maps.mjs와 같다)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const REGIONS = ["seomun"]; // 지도 안에 고가 모노레일이 지나는 지역
const MARGIN = 350; // 지도 밖으로 이만큼(m)까지 남긴다 (배경 건물과 같다)

async function overpass(query) {
  for (const url of ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
    try {
      const res = await fetch(url, { method: "POST", signal: AbortSignal.timeout(100000),
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "sound-walk-map-builder" }, body: "data=" + encodeURIComponent(query) });
      const text = await res.text();
      if (res.ok && text.trimStart().startsWith("{")) return JSON.parse(text);
    } catch (e) { /* 다음 서버 */ }
  }
  throw new Error("Overpass 서버에서 받지 못했습니다");
}

const out = {};
for (const id of REGIONS) {
  const d = JSON.parse(readFileSync(join(ROOT, "data", id + ".json"), "utf8"));
  const [la, lo] = d.center, half = d.size / 2, h = half + MARGIN, mx = 111320 * Math.cos((la * Math.PI) / 180);
  const bb = [la - h / 110540, lo - h / mx, la + h / 110540, lo + h / mx].join(",");
  const res = await overpass(`[out:json][timeout:60];(way[railway=monorail](${bb});node[railway=station](${bb}););out geom tags;`);
  const toXZ = (p) => [Math.round(((p.lon - lo) * mx + half) * 10) / 10, Math.round((-(p.lat - la) * 110540 + half) * 10) / 10];
  const inBox = ([x, z]) => x > -MARGIN && z > -MARGIN && x < d.size + MARGIN && z < d.size + MARGIN;
  const lines = [], stations = [];
  for (const e of res.elements) {
    if (e.type === "node") { const p = toXZ(e); if (inBox(p)) stations.push({ name: e.tags.name || "", x: p[0], z: p[1] }); continue; }
    // 상하행이 따로 그려져 있으면 하나만 남긴다 (게임은 선로 두 줄을 한 번에 그린다)
    const pts = e.geometry.map(toXZ).filter(inBox);
    if (pts.length >= 2) lines.push({ name: e.tags.name || "", pts });
  }
  lines.sort((a, b) => b.pts.length - a.pts.length);
  out[id] = { lines: lines.slice(0, 1), stations, source: "OpenStreetMap railway=monorail (ODbL)", at: new Date().toISOString().slice(0, 10) };
  console.log(id, "선로", lines.slice(0, 1).map((l) => `${l.name} ${l.pts.length}점`).join(", "), "역", stations.map((s) => s.name).join(", "));
}
writeFileSync(join(ROOT, "data", "rail.json"), JSON.stringify(out, null, 1) + "\n");
