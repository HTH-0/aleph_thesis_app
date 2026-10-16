// OpenStreetMap 데이터를 받아 게임용 지도(data/<id>.json)로 바꾼다.
// 지도 파일에는 이동 판정용 격자와, 화면에 그릴 건물·도로·녹지·나무가 함께 들어간다.
// 실행: node tools/build_maps.mjs            (모든 지역)
//       node tools/build_maps.mjs mokdong    (한 지역만, 여러 개는 쉼표로)
// 지도 데이터: © OpenStreetMap contributors, ODbL 1.0
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { readShapefile, tmFromPrj } from "./shapefile.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "data");
// 공공데이터 원본 (저장소와 배포물에는 넣지 않는다. 출처는 참고자료/공공데이터/출처.txt)
const PUBLIC_DIR = join(ROOT, "참고자료", "공공데이터");
const PUBLIC_CROSSWALKS = {
  seoul: { file: "seoul_crosswalk/A004_A", source: "서울시 교통안전시설물 횡단보도 정보 (서울 열린데이터광장, 공공누리 제1유형)" },
  daegu: { file: "daegu_crosswalk/A0043325", source: "대구광역시_횡단보도 (공공데이터포털)" },
};

// 지역 목록. center는 지도 가운데, half는 지도 한 변의 절반(m).
export const REGIONS = [
  { id: "mokdong", city: "seoul", name: "목동", desc: "서울 · 목동야구장 · 아파트 단지", center: [37.5310, 126.8790], half: 420 },
  { id: "jamsil", city: "seoul", name: "잠실", desc: "서울 · 잠실종합운동장 · 아파트 단지", center: [37.5110, 127.0800], half: 420 },
  { id: "gocheok", city: "seoul", name: "고척", desc: "서울 · 고척스카이돔 · 구로 골목", center: [37.4985, 126.8660], half: 420 },
  { id: "worldcup", city: "seoul", name: "상암", desc: "서울 · 서울월드컵경기장 · 성산동", center: [37.5675, 126.8990], half: 420 },
  { id: "banwoldang", city: "daegu", name: "반월당", desc: "대구 · 반월당역 · 더현대 대구", center: [35.8655, 128.5934], half: 420 },
  { id: "dongseongro", city: "daegu", name: "동성로", desc: "대구 · 동성로 · 국채보상운동기념공원", center: [35.8690, 128.6010], half: 420 },
  { id: "seomun", city: "daegu", name: "서문시장", desc: "대구 · 서문시장 · 대신동", center: [35.8691, 128.5800], half: 420 },
];

const CELL = 2; // 격자 한 칸(m)
const LANDMARK_MARGIN = 200; // 지도 밖이라도 이 거리(m) 안의 장소는 소리 후보로 쓴다
const SCENERY_MARGIN = 350; // 지도 밖이라도 이 거리(m) 안의 건물·도로·녹지는 배경으로 그린다 (안개가 끝나는 거리보다 조금 넓게)
const FLOOR = 3.3; // 층 높이(m)

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// 차도 종류별 기본 폭(m). lanes 태그가 있으면 차로 수로 계산한다.
const ROAD_WIDTH = {
  primary: 22, secondary: 20, tertiary: 13,
  primary_link: 8, secondary_link: 8, tertiary_link: 8, trunk: 22, trunk_link: 8,
  residential: 7, unclassified: 7, living_street: 6, road: 6, service: 4.5,
};
// 걷는 길(그리지 않고 걷는 영역에만 넣는다)의 폭(m)
const PATH_WIDTH = { footway: 3, path: 3, cycleway: 3, steps: 3, track: 3, corridor: 3 };
const SIDEWALK = 4; // 차도 양쪽 보도 폭(m)
const WIDE_ROAD = 10; // 이 폭(m) 이상인 차도는 걸어서 들어갈 수 없고, 교차로 앞 횡단보도로만 건넌다 (js/config.js의 WIDE_ROAD와 같다)
const LOW_TYPES = new Set(["house", "detached", "hut", "shed", "garage", "garages", "kiosk", "toilets", "bungalow"]);

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
    await new Promise((r) => setTimeout(r, 8000));
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
  if (t.amenity === "marketplace") return "market";
  return null;
}

const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// 0~1 사이의 고정 난수 (같은 OSM id면 항상 같은 값)
function hash01(n) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function ringArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

// 층수 기록이 없으면 용도와 바닥 면적으로 높이를 추정한다
function buildingHeight(t, area, seed) {
  const h = num(t.height);
  if (h) return { h, measured: true };
  const lv = num(t["building:levels"]);
  if (lv) return { h: lv * FLOOR + 1, measured: true };
  const r = hash01(seed);
  const b = t.building;
  let floors;
  if (LOW_TYPES.has(b)) floors = 1 + (r < 0.45 ? 1 : 0);
  else if (b === "apartments") floors = 12 + Math.floor(r * 13);
  else if (b === "church" || b === "cathedral" || b === "chapel") floors = 3;
  else if (area < 60) floors = 1 + Math.floor(r * 2);
  else if (area < 160) floors = 2 + Math.floor(r * 3);
  else if (area < 450) floors = 3 + Math.floor(r * 4);
  else if (area < 1300) floors = 5 + Math.floor(r * 6);
  else floors = 8 + Math.floor(r * 9);
  return { h: floors * FLOOR + 0.8, measured: false };
}

function buildingKind(t) {
  const b = t.building;
  if (b === "roof") return "roof";
  if (b === "church" || b === "cathedral" || b === "chapel" || /성당|교회/.test(t.name || "")) return "church";
  if (b === "apartments") return "apartments";
  if (LOW_TYPES.has(b)) return "low";
  return "other";
}

const pubCache = {};
function publicCrosswalks(region, toXZ, size) {
  const src = PUBLIC_CROSSWALKS[region.city];
  if (!src) return null;
  const base = join(PUBLIC_DIR, src.file);
  if (!existsSync(base + ".shp")) { console.warn(`[${region.id}] 공공 횡단보도 파일이 없어 규칙 횡단보도만 씁니다: ${base}.shp`); return null; }
  if (!pubCache[region.city]) {
    const shp = readShapefile(base), toLL = tmFromPrj(shp.prj);
    pubCache[region.city] = shp.features.filter((ft) => ft.geom && ft.geom.rings && ft.geom.rings[0].length >= 3)
      .map((ft) => ft.geom.rings[0].map(([x, y]) => toLL(x, y)));
  }
  const out = [];
  for (const ring of pubCache[region.city]) {
    const pts = ring.map(([lon, lat]) => toXZ({ lon, lat }));
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    if (cx > -50 && cz > -50 && cx < size + 50 && cz < size + 50) out.push(pts);
  }
  return out;
}

async function buildRegion(region) {
  const box = (extra) => bboxOf(region, extra).join(",");
  const bb = box(0), sbb = box(SCENERY_MARGIN), lbb = box(LANDMARK_MARGIN);
  const query = `[out:json][timeout:180];
(
  way[highway](${sbb});
  way[building](${sbb});
  relation[building](${sbb});
  way[leisure~"^(park|garden|pitch|playground)$"](${sbb});
  way[landuse~"^(grass|park|forest|recreation_ground|village_green)$"](${sbb});
  way[natural~"^(wood|scrub|grassland)$"](${sbb});
  way[waterway=river](${sbb});
  way[natural=water](${sbb});
  way[place=square](${bb});
  way[amenity=parking](${bb});
  node[natural=tree](${bb});
  way[natural=tree_row](${bb});
  nwr[leisure=stadium](${lbb});
  nwr[landuse=construction](${lbb});
  nwr[building=construction](${lbb});
  nwr[amenity=place_of_worship](${lbb});
  nwr[amenity=fountain](${lbb});
  nwr[leisure=playground](${lbb});
  nwr[amenity=marketplace](${lbb});
  node[highway=crossing](${bb});
);
out geom;`;
  console.log(`[${region.id}] Overpass 요청`);
  const data = await overpass(query);

  const [lat0, lon0] = region.center;
  const mx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const size = region.half * 2;
  const N = Math.round(size / CELL);
  // 지도 좌표: x는 동쪽(+), z는 남쪽(+), 원점은 지도 북서쪽 모서리
  const toXZ = (p) => [
    Math.round(((p.lon - lon0) * mx + region.half) * 10) / 10,
    Math.round((-(p.lat - lat0) * 110540 + region.half) * 10) / 10,
  ];
  const inside = (x, z, m) => x > -m && z > -m && x < size + m && z < size + m;

  const area = new Uint8Array(N * N); // 걸을 수 있는 영역(건물을 빼기 전)
  const building = new Uint8Array(N * N);

  function stampDisk(x, z, radius) {
    const c0 = Math.floor((x - radius) / CELL), c1 = Math.floor((x + radius) / CELL);
    const r0 = Math.floor((z - radius) / CELL), r1 = Math.floor((z + radius) / CELL);
    for (let r = Math.max(0, r0); r <= Math.min(N - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(N - 1, c1); c++) {
        const cx = c * CELL + CELL / 2, cz = r * CELL + CELL / 2;
        if ((cx - x) ** 2 + (cz - z) ** 2 <= radius * radius) area[r * N + c] = 1;
      }
    }
  }
  function stampLine(geom, radius) {
    for (let i = 0; i + 1 < geom.length; i++) {
      const [x1, z1] = geom[i], [x2, z2] = geom[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / (CELL / 2)));
      for (let k = 0; k <= steps; k++) stampDisk(x1 + ((x2 - x1) * k) / steps, z1 + ((z2 - z1) * k) / steps, radius);
    }
  }
  function fillPolygon(pts, target) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    for (let r = Math.max(0, Math.floor(minZ / CELL)); r <= Math.min(N - 1, Math.floor(maxZ / CELL)); r++) {
      for (let c = Math.max(0, Math.floor(minX / CELL)); c <= Math.min(N - 1, Math.floor(maxX / CELL)); c++) {
        const px = c * CELL + CELL / 2, pz = r * CELL + CELL / 2;
        let ins = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, zi] = pts[i], [xj, zj] = pts[j];
          if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) ins = !ins;
        }
        if (ins) target[r * N + c] = 1;
      }
    }
  }
  const closeRing = (geom) => {
    const pts = geom.slice();
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    return pts.length >= 3 ? pts : null;
  };

  const buildings = [], roads = [], green = [], trees = [], landmarks = [], crossings = [];
  let measured = 0;
  function addBuilding(pts, t, id) {
    const a = Math.abs(ringArea(pts));
    if (a < 6) return;
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    if (!inside(cx, cz, SCENERY_MARGIN)) return;
    const kind = buildingKind(t);
    const { h, measured: m } = kind === "roof" ? { h: 4, measured: false } : buildingHeight(t, a, id);
    if (m) measured++;
    const out = !inside(cx, cz, 0);
    const p = out ? pts.map(([x, z]) => [Math.round(x * 2) / 2, Math.round(z * 2) / 2]) : pts;
    buildings.push({ p, h: Math.round(h * 10) / 10, k: kind, m: m ? 1 : 0 });
    if (kind !== "roof") fillPolygon(pts, building); // 지붕만 있는 구조물(주유소 캐노피 등)은 밑으로 걸어 다닐 수 있다
  }

  for (const el of data.elements) {
    const t = el.tags || {};
    const geom = el.geometry ? el.geometry.map(toXZ) : null;

    if (el.type === "way" && t.highway && geom && t.tunnel !== "yes" && !(Number(t.layer) < 0)) {
      if (ROAD_WIDTH[t.highway]) {
        const lanes = num(t.lanes);
        const w = num(t.width) || (lanes ? lanes * 3.3 + 1.5 : ROAD_WIDTH[t.highway]);
        const bridge = (t.bridge && t.bridge !== "no") || Number(t.layer) > 0;
        roads.push({ p: geom, w: Math.round(w * 10) / 10, k: "car", ln: lanes || 0, ...(bridge ? { br: 1 } : {}) });
        stampLine(geom, w / 2 + (w >= 10 ? SIDEWALK : SIDEWALK / 2));
      } else if (t.highway === "pedestrian") {
        const w = num(t.width) || 10;
        if (t.area === "yes" && closeRing(geom)) { green.push({ p: closeRing(geom), k: "plaza" }); fillPolygon(closeRing(geom), area); }
        else { roads.push({ p: geom, w, k: "plaza", ln: 0 }); stampLine(geom, w / 2 + 1); }
      } else if (PATH_WIDTH[t.highway]) {
        stampLine(geom, PATH_WIDTH[t.highway] / 2 + 0.5);
      }
    }
    if (t.building && geom && el.type === "way") {
      const pts = closeRing(geom);
      if (pts) addBuilding(pts, t, el.id);
    }
    if (t.building && el.type === "relation" && el.members) {
      for (const m of el.members) {
        if (m.role !== "outer" || !m.geometry) continue;
        const pts = closeRing(m.geometry.map(toXZ));
        if (pts) addBuilding(pts, t, el.id + m.ref);
      }
    }
    if (el.type === "way" && geom && !t.building && !t.highway) {
      const pts = closeRing(geom);
      const g = t.natural === "water" ? "water" : t.leisure || t.landuse || t.natural || (t.place === "square" ? "plaza" : null) || (t.amenity === "parking" ? "parking" : null);
      if (pts && g && g !== "tree_row" && !t.waterway) {
        green.push({ p: pts, k: g });
        if (g !== "water") fillPolygon(pts, area); // 공원, 광장, 주차장은 걸어 다닐 수 있다
      }
      if (t.natural === "tree_row") for (const p of geom) trees.push(p);
    }
    if (el.type === "node" && t.highway === "crossing") crossings.push(toXZ(el));
    if (el.type === "node" && t.natural === "tree") {
      const p = toXZ(el);
      if (inside(p[0], p[1], 0)) trees.push(p);
    }

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
      if (inside(x, z, LANDMARK_MARGIN)) landmarks.push({ type, name: t.name || null, x: Math.round(x), z: Math.round(z), osm: `${el.type}/${el.id}` });
    }
  }

  // ---------- 큰 차도와 횡단보도 ----------
  // 큰 차도(폭 WIDE_ROAD 이상)의 차로 칸은 막는다. 건널 수 있는 곳은 다음 순서로 정한다.
  //  1) 공공데이터 횡단보도(서울시·대구시 횡단보도 도형): 실제 위치와 모양 그대로 연다.
  //  2) 규칙 횡단보도(교차로, OSM 횡단보도, 220m 넘게 건널 곳이 없는 큰길의 중간):
  //     공공데이터가 있으면, 실제 횡단보도가 근처에 없고 그 자리를 열어야 걷는 영역이 끊기지 않을 때만 연다.
  //     공공데이터가 없으면 모두 연다. js/scenery.js는 여기서 정한 횡단보도만 그린다.
  const carway = new Uint8Array(N * N);
  const keyOf = (p) => p[0].toFixed(1) + "," + p[1].toFixed(1);
  const nodeUse = new Map();
  // 교차로는 폭 5m 이상 차도끼리 만나는 곳만 센다 (주차장 진입로 같은 서비스 도로는 빼서 횡단보도가 너무 많아지지 않게 한다)
  for (const rd of roads) if (rd.k === "car" && rd.w >= 5) for (const p of rd.p) {
    const e = nodeUse.get(keyOf(p)) || { n: 0, w: 0, p };
    e.n++; e.w = Math.max(e.w, rd.w); nodeUse.set(keyOf(p), e);
  }
  const junctions = [...nodeUse.values()].filter((e) => e.n >= 2).map((e) => ({ x: e.p[0], z: e.p[1], r: e.w / 2 + 2.5 }));
  const MAX_GAP = 220;
  const DUAL = 20; // 상하행이 따로 그려진 큰길(두 줄 차도)도 함께 열리도록, 횡단보도는 이 거리(m) 안의 나란한 차도까지 연다
  const wideRoads = roads.filter((rd) => rd.k === "car" && rd.w >= WIDE_ROAD && !rd.br);

  // 큰 차도 칸
  for (const rd of wideRoads) {
    const hw = rd.w / 2 - 0.2;
    for (let i = 0; i + 1 < rd.p.length; i++) {
      const [x1, z1] = rd.p[i], [x2, z2] = rd.p[i + 1];
      const L = Math.hypot(x2 - x1, z2 - z1);
      if (L < 0.01) continue;
      const tx = (x2 - x1) / L, tz = (z2 - z1) / L;
      const minX = Math.min(x1, x2) - hw, maxX = Math.max(x1, x2) + hw, minZ = Math.min(z1, z2) - hw, maxZ = Math.max(z1, z2) + hw;
      for (let r = Math.max(0, Math.floor(minZ / CELL)); r <= Math.min(N - 1, Math.floor(maxZ / CELL)); r++) {
        for (let c = Math.max(0, Math.floor(minX / CELL)); c <= Math.min(N - 1, Math.floor(maxX / CELL)); c++) {
          const px = c * CELL + CELL / 2, pz = r * CELL + CELL / 2;
          const t = Math.max(0, Math.min(L, (px - x1) * tx + (pz - z1) * tz));
          if (Math.hypot(x1 + tx * t - px, z1 + tz * t - pz) <= hw) carway[r * N + c] = 1;
        }
      }
    }
  }

  // 1) 공공데이터 횡단보도: 가장 가까운 차도의 방향에 맞춘 사각형(길 방향 길이 L, 길을 가로지르는 길이 W)으로 정리한다
  const pub = publicCrosswalks(region, toXZ, size);
  const hasPublic = pub !== null;
  const crosswalks = [];
  const pubOpen = new Uint8Array(N * N);
  for (const ring of pub || []) {
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    let best = null;
    for (const rd of roads) {
      if (rd.k !== "car") continue;
      for (let i = 0; i + 1 < rd.p.length; i++) {
        const [x1, z1] = rd.p[i], [x2, z2] = rd.p[i + 1], L = Math.hypot(x2 - x1, z2 - z1);
        if (L < 0.01) continue;
        const tx = (x2 - x1) / L, tz = (z2 - z1) / L;
        const t = Math.max(0, Math.min(L, (cx - x1) * tx + (cz - z1) * tz));
        const d = Math.hypot(x1 + tx * t - cx, z1 + tz * t - cz);
        if (!best || d - rd.w / 2 < best.d - best.w / 2) best = { d, tx, tz, w: rd.w };
      }
    }
    if (!best || best.d > best.w / 2 + 4) continue; // 차도 위가 아니다 (주차장 안 등)
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of ring) {
      const a = (x - cx) * best.tx + (z - cz) * best.tz, b = -(x - cx) * best.tz + (z - cz) * best.tx;
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    }
    const am = (a0 + a1) / 2, bm = (b0 + b1) / 2;
    const r1 = (v) => Math.round(v * 10) / 10;
    crosswalks.push({ x: r1(cx + best.tx * am - best.tz * bm), z: r1(cz + best.tz * am + best.tx * bm), tx: +best.tx.toFixed(4), tz: +best.tz.toFixed(4),
      L: r1(Math.max(2, a1 - a0)), W: r1(Math.max(3, b1 - b0)), ...(best.w >= WIDE_ROAD ? { wide: 1 } : {}) });
    if (best.w < WIDE_ROAD) continue;
    // 도형 안(과 가장자리 0.6m) 칸을 연다
    const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
    for (let r = Math.max(0, Math.floor((Math.min(...zs) - 1) / CELL)); r <= Math.min(N - 1, Math.floor((Math.max(...zs) + 1) / CELL)); r++) {
      for (let c = Math.max(0, Math.floor((Math.min(...xs) - 1) / CELL)); c <= Math.min(N - 1, Math.floor((Math.max(...xs) + 1) / CELL)); c++) {
        const px = c * CELL + CELL / 2, pz = r * CELL + CELL / 2;
        let ins = false, near = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, zi] = ring[i], [xj, zj] = ring[j];
          if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) ins = !ins;
          const dx = xj - xi, dz = zj - zi, LL = dx * dx + dz * dz;
          const t = LL > 0 ? Math.max(0, Math.min(1, ((px - xi) * dx + (pz - zi) * dz) / LL)) : 0;
          if (Math.hypot(xi + dx * t - px, zi + dz * t - pz) < 0.6) near = true;
        }
        if (ins || near) pubOpen[r * N + c] = 1;
      }
    }
  }
  const nearPub = (x, z, r) => crosswalks.some((c) => Math.hypot(c.x - x, c.z - z) < r);
  // 공공 횡단보도 도형이 차도 폭 일부만 덮거나 두 줄 차도의 한쪽에만 있을 수 있으므로,
  // 같은 줄 위의 큰 차도 칸(DUAL 안의 나란한 차도 포함)을 횡단보도 폭만큼 함께 연다
  for (const cw of crosswalks) {
    if (!cw.wide) continue;
    const halfL = Math.max(1.5, cw.L / 2);
    for (const rd of wideRoads) for (let i = 0; i + 1 < rd.p.length; i++) {
      const [x1, z1] = rd.p[i], [x2, z2] = rd.p[i + 1], L = Math.hypot(x2 - x1, z2 - z1);
      if (L < 0.01) continue;
      const tx = (x2 - x1) / L, tz = (z2 - z1) / L;
      const along = (cw.x - x1) * tx + (cw.z - z1) * tz, across = Math.abs(-(cw.x - x1) * tz + (cw.z - z1) * tx);
      if (along < -halfL || along > L + halfL || across > rd.w / 2 + DUAL) continue;
      const ox = x1 + tx * along, oz = z1 + tz * along, hw = rd.w / 2 + 1;
      for (let r = Math.max(0, Math.floor((oz - hw - halfL) / CELL)); r <= Math.min(N - 1, Math.floor((oz + hw + halfL) / CELL)); r++)
        for (let c = Math.max(0, Math.floor((ox - hw - halfL) / CELL)); c <= Math.min(N - 1, Math.floor((ox + hw + halfL) / CELL)); c++) {
          const px = c * CELL + CELL / 2, pz = r * CELL + CELL / 2;
          if (Math.abs((px - ox) * cw.tx + (pz - oz) * cw.tz) < halfL && Math.abs(-(px - ox) * cw.tz + (pz - oz) * cw.tx) < hw && carway[r * N + c]) pubOpen[r * N + c] = 1;
        }
    }
  }

  // 2) 규칙 횡단보도 후보: 교차로 앞 원, OSM 횡단보도와 중간 횡단보도의 띠
  for (const rd of wideRoads) {
    const cum = [0];
    for (let i = 1; i < rd.p.length; i++) cum.push(cum[i - 1] + Math.hypot(rd.p[i][0] - rd.p[i - 1][0], rd.p[i][1] - rd.p[i - 1][1]));
    const at = (d) => {
      let i = 1;
      while (i < rd.p.length - 1 && cum[i] < d) i++;
      const t = (d - cum[i - 1]) / Math.max(0.01, cum[i] - cum[i - 1]);
      return [rd.p[i - 1][0] + (rd.p[i][0] - rd.p[i - 1][0]) * t, rd.p[i - 1][1] + (rd.p[i][1] - rd.p[i - 1][1]) * t];
    };
    const opens = [0, cum[cum.length - 1]];
    rd.p.forEach((p, i) => { const e = nodeUse.get(keyOf(p)); if (e && e.n >= 2) opens.push(cum[i]); });
    const pts = [...crossings, ...crosswalks.filter((c) => c.wide).map((c) => [c.x, c.z])];
    for (const c of pts) for (let i = 1; i < rd.p.length; i++) {
      const [x1, z1] = rd.p[i - 1], [x2, z2] = rd.p[i], L = cum[i] - cum[i - 1];
      if (L < 0.01) continue;
      const along = ((c[0] - x1) * (x2 - x1) + (c[1] - z1) * (z2 - z1)) / L;
      const across = Math.abs((-(c[0] - x1) * (z2 - z1) + (c[1] - z1) * (x2 - x1)) / L);
      if (along >= 0 && along <= L && across < rd.w / 2 + DUAL) opens.push(cum[i - 1] + along);
    }
    opens.sort((a, b) => a - b);
    for (let k = 1; k < opens.length; k++) {
      const gap = opens[k] - opens[k - 1];
      if (gap <= MAX_GAP) continue;
      const parts = Math.ceil(gap / (MAX_GAP * 0.9));
      for (let q = 1; q < parts; q++) {
        const p = at(opens[k - 1] + (gap * q) / parts);
        if (inside(p[0], p[1], -20)) crossings.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
      }
    }
  }
  const cands = [];
  const cellsWhere = (x, z, R, test) => {
    const out = [];
    for (let r = Math.max(0, Math.floor((z - R) / CELL)); r <= Math.min(N - 1, Math.floor((z + R) / CELL)); r++)
      for (let c = Math.max(0, Math.floor((x - R) / CELL)); c <= Math.min(N - 1, Math.floor((x + R) / CELL)); c++) {
        const i = r * N + c;
        if (carway[i] && test(c * CELL + CELL / 2, r * CELL + CELL / 2)) out.push(i);
      }
    return out;
  };
  for (const j of junctions) {
    if (hasPublic && nearPub(j.x, j.z, 35)) continue; // 실제 횡단보도가 있는 교차로는 그것을 쓴다
    const cells = cellsWhere(j.x, j.z, j.r, (px, pz) => Math.hypot(j.x - px, j.z - pz) < j.r);
    if (cells.length) cands.push({ kind: "junction", p: [j.x, j.z], cells });
  }
  for (const cp of crossings) {
    if (hasPublic && nearPub(cp[0], cp[1], 25)) continue;
    const strips = [];
    for (const rd of wideRoads) for (let i = 0; i + 1 < rd.p.length; i++) {
      const [x1, z1] = rd.p[i], [x2, z2] = rd.p[i + 1], L = Math.hypot(x2 - x1, z2 - z1);
      if (L < 0.01) continue;
      const tx = (x2 - x1) / L, tz = (z2 - z1) / L;
      const along = (cp[0] - x1) * tx + (cp[1] - z1) * tz, across = Math.abs(-(cp[0] - x1) * tz + (cp[1] - z1) * tx);
      if (along >= 0 && along <= L && across < rd.w / 2 + DUAL) strips.push({ x: x1 + tx * along, z: z1 + tz * along, tx, tz, hw: rd.w / 2 + 1 });
    }
    const cells = cellsWhere(cp[0], cp[1], 50, (px, pz) => strips.some((o) => Math.abs((px - o.x) * o.tx + (pz - o.z) * o.tz) < 2 && Math.abs(-(px - o.x) * o.tz + (pz - o.z) * o.tx) < o.hw));
    if (cells.length) cands.push({ kind: "crossing", p: cp, cells });
  }

  // 공공 횡단보도 자리를 열고, 규칙 후보는 (공공데이터가 있으면) 끊긴 걷는 영역을 이을 때만 연다
  for (let i = 0; i < N * N; i++) if (pubOpen[i]) carway[i] = 0;
  const usedJunctions = [], usedCrossings = [];
  const applyCand = (cd) => {
    for (const i of cd.cells) carway[i] = 0;
    (cd.kind === "junction" ? usedJunctions : usedCrossings).push(cd.p);
  };
  if (!hasPublic) cands.forEach(applyCand);
  else {
    const base = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) base[i] = area[i] && !building[i] && !carway[i] ? 1 : 0;
    const lab = new Int32Array(N * N).fill(-1), size0 = [];
    for (let i = 0; i < N * N; i++) {
      if (!base[i] || lab[i] !== -1) continue;
      const k = size0.length, st = [i]; lab[i] = k; let cnt = 0;
      while (st.length) {
        const cur = st.pop(); cnt++;
        const r = Math.floor(cur / N), c = cur % N;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= N || nc >= N) continue;
          const ni = nr * N + nc;
          if (base[ni] && lab[ni] === -1) { lab[ni] = k; st.push(ni); }
        }
      }
      size0.push(cnt);
    }
    const parent = size0.map((_, k) => k), total = size0.slice();
    const find = (k) => (parent[k] === k ? k : (parent[k] = find(parent[k])));
    for (const cd of cands) {
      const roots = new Set();
      for (const i of cd.cells) {
        const r = Math.floor(i / N), c = i % N;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= N || nc >= N) continue;
          const l = lab[nr * N + nc];
          if (l >= 0) roots.add(find(l));
        }
      }
      if ([...roots].filter((k) => total[k] >= 300).length < 2) continue; // 이미 이어진 곳이면 열지 않는다
      applyCand(cd);
      const [first, ...rest] = [...roots];
      for (const k of rest) { parent[k] = first; total[first] += total[k]; }
    }
  }
  crossings.length = 0;
  crossings.push(...usedCrossings);

  // 걷는 칸 = 걸을 수 있는 영역이면서 건물 안도, 큰 차도도 아닌 칸. 가장 큰 연결 영역만 남긴다.
  const walk = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) walk[i] = area[i] && !building[i] && !carway[i] ? 1 : 0;
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

  // 칸 문자: "." 걷는 칸, "#" 건물, "=" 큰 차도(막힘), " " 그 밖의 막힌 땅
  const rows = [];
  for (let r = 0; r < N; r++) {
    let row = "";
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      row += walk[i] && comp[i] === best ? "." : building[i] ? "#" : carway[i] ? "=" : " ";
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
    scenery: { buildings, roads, green, trees, crossings, crosswalks, junctionsOpen: usedJunctions, crosswalkSource: hasPublic ? "public" : "rule" },
    sources: {
      crosswalks: hasPublic ? PUBLIC_CROSSWALKS[region.city].source : "규칙(교차로·OSM·중간 횡단보도)",
      crosswalkCounts: { public: crosswalks.length, publicOnWideRoads: crosswalks.filter((c) => c.wide).length, ruleJunctions: usedJunctions.length, ruleCrossings: usedCrossings.length },
    },
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${region.id}.json`), JSON.stringify(out));
  const counts = merged.reduce((a, l) => ((a[l.type] = (a[l.type] || 0) + 1), a), {});
  console.log(`[${region.id}] 걷는 칸 ${bestSize}/${N * N}, 건물 ${buildings.length}(층수 기록 ${measured}), 도로 ${roads.length}, 횡단보도 공공 ${crosswalks.length}(큰길 ${crosswalks.filter((c) => c.wide).length}) + 규칙 교차로 ${usedJunctions.length} + 규칙 띠 ${usedCrossings.length}, 랜드마크`, counts);
}

const only = process.argv[2] ? process.argv[2].split(",") : null;
for (const region of REGIONS.filter((r) => !only || only.includes(r.id))) {
  await buildRegion(region);
  await new Promise((r) => setTimeout(r, 3000)); // Overpass 서버에 연달아 요청하지 않는다
}
writeFileSync(
  join(OUT_DIR, "regions.json"),
  JSON.stringify(REGIONS.map(({ id, name, desc, city }) => ({ id, name, desc, city })))
);
