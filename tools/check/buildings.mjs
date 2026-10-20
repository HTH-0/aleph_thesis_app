// 건물 유형을 나누고, 유형마다 사람이 로드뷰로 볼 대표 건물을 고른다 (검수 화면의 "건물 모습" 판정용)
// 실행: node tools/check/buildings.mjs [지역, 기본 전체]   → 유형별 건물 수와 대표 건물 목록을 찍는다
// 검수 화면(review.mjs)은 buildingReport(지역)을 불러 쓴다.
// 유형은 공공 건물 데이터(GIS건물통합정보)의 구조(st), 사용승인 연도(y), 높이(h), 종류(k), 아파트 단지 이름(nm)으로 나눈다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./browser.mjs";

export const TYPES = [
  { id: "wood", label: "목구조 주택(기와·슬레이트)" },
  { id: "brick_old", label: "벽돌·블록 저층, 1989년 이전" },
  { id: "brick_new", label: "벽돌·블록 저층, 1990년 이후" },
  { id: "rc_old", label: "콘크리트 저층, 1989년 이전" },
  { id: "rc_90s", label: "콘크리트 저층, 1990~2002년" },
  { id: "rc_new", label: "콘크리트 저층, 2003년 이후" },
  { id: "rc_unknown", label: "콘크리트 저층, 연도 모름" },
  { id: "mid", label: "중층 6~10층" },
  { id: "high", label: "고층 11층 이상(아파트 단지 빼고)" },
  { id: "apt", label: "아파트 단지" },
];
const PER_TYPE = 3;     // 유형마다 대표 건물 수
const MIN_GAP = 120;    // 같은 유형 대표 건물끼리 떨어진 거리(m)

export function typeOf(b) {
  if (!b.g || b.k === "church") return null; // 공공 건물만 (OSM만 있는 건물은 구조·연도가 없다)
  const floors = Math.max(1, Math.round(b.h / 3));
  if (b.nm || b.k === "apartments") return "apt";
  if (b.st === "w" || b.k === "wood") return "wood";
  if (floors >= 11) return "high";
  if (floors >= 6) return "mid";
  if (b.st === "b" || b.st === "k") return !b.y ? "brick_old" : b.y < 1990 ? "brick_old" : "brick_new";
  if (!b.y) return "rc_unknown";
  return b.y < 1990 ? "rc_old" : b.y < 2003 ? "rc_90s" : "rc_new";
}

const centroid = (p) => { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; };

export async function buildingReport(id) {
  const d = JSON.parse(readFileSync(join(ROOT, "data", id + ".json"), "utf8"));
  const B = d.scenery.buildings, roads = d.scenery.roads.filter((r) => r.k === "car");
  const size = d.size, n = d.n, cell = size / n;
  const walk = (x, z) => { const c = Math.floor(x / cell), r = Math.floor(z / cell); return r >= 0 && c >= 0 && r < n && c < n && d.grid[r][c] === "."; };
  const counts = Object.fromEntries(TYPES.map((t) => [t.id, 0]));
  const cands = Object.fromEntries(TYPES.map((t) => [t.id, []]));
  B.forEach((b, i) => {
    const t = typeOf(b);
    if (!t) return;
    const [cx, cz] = centroid(b.p);
    if (cx < 0 || cz < 0 || cx > size || cz > size) return; // 지도 밖 배경 건물은 세지 않는다
    counts[t]++;
    // 로드뷰로 보이려면 차도 가까이 있어야 한다: 건물 둘레 점 가운데 차도 중심선에서 가장 가까운 점과 그 차도 위 점
    let best = null;
    for (const q of b.p) for (const rd of roads) for (let k = 0; k + 1 < rd.p.length; k++) {
      const a = rd.p[k], c = rd.p[k + 1], dx = c[0] - a[0], dz = c[1] - a[1], L2 = dx * dx + dz * dz;
      if (!L2) continue;
      const tt = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / L2));
      const px = a[0] + dx * tt, pz = a[1] + dz * tt, dd = Math.hypot(px - q[0], pz - q[1]) - rd.w / 2;
      if (!best || dd < best.dd) best = { dd, px, pz, w: rd.w };
    }
    if (!best || best.dd > 8 || !walk(best.px, best.pz) && best.w < 10 && !walk((best.px + cx) / 2, (best.pz + cz) / 2)) return;
    const floors = Math.max(1, Math.round(b.h / 3));
    cands[t].push({ i, cx, cz, rx: best.px, rz: best.pz, roadW: best.w, floors, y: b.y || null, st: b.st || null, nm: b.nm || null, area: Math.abs(b.p.reduce((s, q, k) => { const r2 = b.p[(k + 1) % b.p.length]; return s + q[0] * r2[1] - r2[0] * q[1]; }, 0)) / 2 });
  });
  const total = Object.values(counts).reduce((a, v) => a + v, 0);
  const points = [];
  for (const t of TYPES) {
    // 너무 작은 건물(창고·부속 건물)은 빼고, 지도 가운데에서 가까운 것부터, 서로 떨어지게 고른다
    const list = cands[t.id].filter((c) => c.area >= 40).sort((a, b) => Math.hypot(a.cx - size / 2, a.cz - size / 2) - Math.hypot(b.cx - size / 2, b.cz - size / 2));
    const picked = [];
    for (const c of list) {
      if (picked.length >= PER_TYPE) break;
      if (picked.some((p) => Math.hypot(p.cx - c.cx, p.cz - c.cz) < MIN_GAP)) continue;
      picked.push(c);
    }
    picked.forEach((c, k) => {
      const dx = c.cx - c.rx, dz = c.cz - c.rz, L = Math.hypot(dx, dz) || 1;
      points.push({ id: `${id}-b-${t.id}-${k + 1}`, type: t.id, label: t.label, x: c.rx, z: c.rz, tx: dx / L, tz: dz / L, building: c.i, bx: c.cx, bz: c.cz,
        floors: c.floors, y: c.y, st: c.st, nm: c.nm, roadW: c.roadW });
    });
  }
  return { region: id, total, types: TYPES.map((t) => ({ ...t, count: counts[t.id], pct: total ? Math.round((100 * counts[t.id]) / total) : 0 })).filter((t) => t.count > 0), points };
}

if (process.argv[1] && process.argv[1].endsWith("buildings.mjs")) {
  const all = JSON.parse(readFileSync(join(ROOT, "data/regions.json"), "utf8")).map((r) => r.id);
  const regions = process.argv[2] ? process.argv[2].split(",") : all;
  for (const id of regions) {
    const r = await buildingReport(id);
    console.log(`[${id}] 공공 건물(지도 안) ${r.total}동`);
    for (const t of r.types) console.log(`  ${t.label.padEnd(24)} ${String(t.count).padStart(5)}동 ${String(t.pct).padStart(3)}%  대표 ${r.points.filter((p) => p.type === t.id).length}곳`);
  }
}
