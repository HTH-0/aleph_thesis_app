// OpenStreetMap 데이터를 받아 게임용 격자 지도(data/<id>.json)로 바꾼다.
// 실행: node tools/build_maps.mjs            (모든 지역)
//       node tools/build_maps.mjs mokdong    (한 지역만)
// 지도 데이터: © OpenStreetMap contributors, ODbL 1.0
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "data");

// 지역 목록. center는 대표 경기장 근처, half는 지도 한 변의 절반(m).
export const REGIONS = [
  { id: "mokdong", name: "목동", desc: "목동야구장 · 아파트 단지", center: [37.5310, 126.8790], half: 420 },
  { id: "jamsil", name: "잠실", desc: "잠실종합운동장 · 아파트 단지", center: [37.5110, 127.0800], half: 420 },
  { id: "gocheok", name: "고척", desc: "고척스카이돔 · 구로 골목", center: [37.4985, 126.8660], half: 420 },
  { id: "worldcup", name: "상암", desc: "서울월드컵경기장 · 성산동", center: [37.5675, 126.8990], half: 420 },
];

const CELL = 4; // 격자 한 칸(m)
const LANDMARK_MARGIN = 200; // 지도 밖이라도 이 거리(m) 안의 장소는 소리 후보로 쓴다

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

// 도로 종류별 걷는 폭(m)
const ROAD_WIDTH = {
  trunk: 18, primary: 16, secondary: 12, tertiary: 10,
  trunk_link: 8, primary_link: 8, secondary_link: 8, tertiary_link: 8,
  residential: 7, unclassified: 7, living_street: 6, road: 6,
  service: 5, pedestrian: 6,
  footway: 3, path: 3, cycleway: 3, steps: 3, track: 3, corridor: 3,
};

function bboxOf(region, extra = 0) {
  const [lat, lon] = region.center;
  const h = region.half + extra;
  const dLat = h / 110540;
  const dLon = h / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
}

async function overpass(query) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "sound-walk-map-builder" },
          body: "data=" + encodeURIComponent(query),
        });
        const text = await res.text();
        if (res.ok && text.trimStart().startsWith("{")) return JSON.parse(text);
        lastErr = new Error(`${url} -> ${res.status}`);
      } catch (e) {
        lastErr = e;
      }
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw lastErr;
}

function classifyLandmark(t) {
  if (t.leisure === "stadium") return "stadium";
  if (t.landuse === "construction" || t.building === "construction") return "construction";
  if (t.amenity === "place_of_worship" && t.religion === "christian") return "church";
  if (t.amenity === "place_of_worship" && t.religion === "buddhist") return "temple";
  if (t.amenity === "fountain") return "fountain";
  if (t.leisure === "playground") return "playground";
  return null;
}

async function buildRegion(region) {
  const [s, w, n, e] = bboxOf(region);
  const [ls, lw, ln, le] = bboxOf(region, LANDMARK_MARGIN);
  const bb = `${s},${w},${n},${e}`;
  const lbb = `${ls},${lw},${ln},${le}`;
  const query = `[out:json][timeout:120];
(
  way[highway](${bb});
  way[building](${bb});
  nwr[leisure=stadium](${lbb});
  nwr[landuse=construction](${lbb});
  nwr[building=construction](${lbb});
  nwr[amenity=place_of_worship](${lbb});
  nwr[amenity=fountain](${lbb});
  nwr[leisure=playground](${lbb});
);
out geom;`;
  console.log(`[${region.id}] Overpass 요청`);
  const data = await overpass(query);

  const [lat0, lon0] = region.center;
  const mx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const size = region.half * 2;
  const N = Math.round(size / CELL);
  // 지도 좌표: x는 동쪽(+), z는 남쪽(+), 원점은 지도 북서쪽 모서리
  const toXZ = (p) => [(p.lon - lon0) * mx + region.half, -(p.lat - lat0) * 110540 + region.half];

  const road = new Uint8Array(N * N);
  const building = new Uint8Array(N * N);

  function stampDisk(x, z, radius) {
    const c0 = Math.floor((x - radius) / CELL), c1 = Math.floor((x + radius) / CELL);
    const r0 = Math.floor((z - radius) / CELL), r1 = Math.floor((z + radius) / CELL);
    for (let r = Math.max(0, r0); r <= Math.min(N - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(N - 1, c1); c++) {
        const cx = c * CELL + CELL / 2, cz = r * CELL + CELL / 2;
        if ((cx - x) ** 2 + (cz - z) ** 2 <= radius * radius) road[r * N + c] = 1;
      }
    }
  }

  function fillPolygon(pts) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    for (let r = Math.max(0, Math.floor(minZ / CELL)); r <= Math.min(N - 1, Math.floor(maxZ / CELL)); r++) {
      for (let c = Math.max(0, Math.floor(minX / CELL)); c <= Math.min(N - 1, Math.floor(maxX / CELL)); c++) {
        const px = c * CELL + CELL / 2, pz = r * CELL + CELL / 2;
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, zi] = pts[i], [xj, zj] = pts[j];
          if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
        }
        if (inside) building[r * N + c] = 1;
      }
    }
  }

  const landmarks = [];
  for (const el of data.elements) {
    const t = el.tags || {};
    const geom = el.geometry ? el.geometry.map(toXZ) : null;

    if (el.type === "way" && t.highway && geom && ROAD_WIDTH[t.highway] && t.tunnel !== "yes" && !(Number(t.layer) < 0)) {
      const radius = Math.max(CELL * 0.75, ROAD_WIDTH[t.highway] / 2);
      for (let i = 0; i + 1 < geom.length; i++) {
        const [x1, z1] = geom[i], [x2, z2] = geom[i + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / (CELL / 2)));
        for (let k = 0; k <= steps; k++) stampDisk(x1 + ((x2 - x1) * k) / steps, z1 + ((z2 - z1) * k) / steps, radius);
      }
    }
    if (el.type === "way" && t.building && geom && geom.length >= 3) fillPolygon(geom);

    const type = classifyLandmark(t);
    if (type) {
      let x, z;
      if (el.type === "node") [x, z] = toXZ(el);
      else if (geom && geom.length) {
        x = geom.reduce((a, p) => a + p[0], 0) / geom.length;
        z = geom.reduce((a, p) => a + p[1], 0) / geom.length;
      } else if (el.bounds) {
        [x, z] = toXZ({ lat: (el.bounds.minlat + el.bounds.maxlat) / 2, lon: (el.bounds.minlon + el.bounds.maxlon) / 2 });
      } else continue;
      landmarks.push({ type, name: t.name || null, x: Math.round(x), z: Math.round(z), osm: `${el.type}/${el.id}` });
    }
  }

  // 걷는 칸 = 도로이면서 건물 안이 아닌 칸. 가장 큰 연결 영역만 남긴다.
  const walk = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) walk[i] = road[i] && !building[i] ? 1 : 0;
  const comp = new Int32Array(N * N).fill(-1);
  let best = -1, bestSize = 0, id = 0;
  for (let i = 0; i < N * N; i++) {
    if (!walk[i] || comp[i] !== -1) continue;
    const stack = [i]; comp[i] = id; let count = 0;
    while (stack.length) {
      const cur = stack.pop(); count++;
      const r = Math.floor(cur / N), c = cur % N;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= N || nc >= N) continue;
        const ni = nr * N + nc;
        if (walk[ni] && comp[ni] === -1) { comp[ni] = id; stack.push(ni); }
      }
    }
    if (count > bestSize) { bestSize = count; best = id; }
    id++;
  }

  // 칸 문자: "." 걷는 칸, "#" 건물, " " 그 밖의 막힌 땅
  const rows = [];
  for (let r = 0; r < N; r++) {
    let row = "";
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      row += walk[i] && comp[i] === best ? "." : building[i] ? "#" : " ";
    }
    rows.push(row);
  }

  // 같은 장소가 여러 요소로 들어온 경우(노드+면) 30m 안의 같은 종류는 하나로 합친다
  const merged = [];
  for (const lm of landmarks) {
    if (!merged.some((m) => m.type === lm.type && Math.hypot(m.x - lm.x, m.z - lm.z) < 30)) merged.push(lm);
  }

  const out = {
    id: region.id, name: region.name, desc: region.desc,
    center: region.center, size, cell: CELL, n: N,
    attribution: "© OpenStreetMap contributors (ODbL)",
    builtAt: new Date().toISOString().slice(0, 10),
    grid: rows, landmarks: merged,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${region.id}.json`), JSON.stringify(out));
  const counts = merged.reduce((a, l) => ((a[l.type] = (a[l.type] || 0) + 1), a), {});
  console.log(`[${region.id}] 걷는 칸 ${bestSize}/${N * N}, 랜드마크`, counts);
}

const only = process.argv[2];
for (const region of REGIONS.filter((r) => !only || r.id === only)) {
  await buildRegion(region);
}
writeFileSync(
  join(OUT_DIR, "regions.json"),
  JSON.stringify(REGIONS.map(({ id, name, desc }) => ({ id, name, desc })))
);
