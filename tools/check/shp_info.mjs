// Shapefile의 열 이름, 처음 몇 개 값, 위경도로 바꾼 첫 좌표를 보여 준다 (새 공공데이터를 처음 열어 볼 때 쓴다)
// 실행: node tools/check/shp_info.mjs <.shp 경로(확장자는 빼도 된다)> [보여 줄 개수, 기본 3]
import { readShapefile, tmFromPrj } from "../shapefile.mjs";

const base = (process.argv[2] || "").replace(/\.shp$/i, "");
if (!base) { console.error("사용법: node tools/check/shp_info.mjs <.shp 경로>"); process.exit(1); }
const count = Number(process.argv[3]) || 3;
const s = readShapefile(base);
console.log(`인코딩 ${s.encoding}, 도형 ${s.features.length}개`);
console.log("열:", s.fields.map((f) => `${f.name}(${f.type}${f.len})`).join(" "));
let toLL = null;
try { toLL = tmFromPrj(s.prj); } catch (e) { console.log("좌표계:", e.message); }
for (const f of s.features.slice(0, count)) {
  const p = f.geom && (f.geom.rings ? f.geom.rings[0][0] : f.geom.pts[0]);
  const ll = p && toLL ? toLL(p[0], p[1]).map((v) => v.toFixed(6)).join(", ") : "?";
  console.log(JSON.stringify(f.props), "→ 경도·위도", ll, f.geom ? f.geom.type : "도형 없음");
}
