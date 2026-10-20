// 지도마다 소리 3개와 두 판의 경로가 만들어지는지 검사한다 (브라우저 없이 node로 게임 코드를 불러 쓴다)
// 실행: node tools/check/routes.mjs [시드 수, 기본 10]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { ROOT } from "./browser.mjs";

const seeds = Number(process.argv[2]) || 10;
const ctx = { console, Math, Uint8Array, Int32Array, Array, Error, JSON, encodeURIComponent, Number, Set, Map };
ctx.fetch = async (url) => ({ ok: true, json: async () => JSON.parse(readFileSync(join(ROOT, url), "utf8")) });
vm.createContext(ctx);
for (const f of ["js/config.js", "js/world.js"]) vm.runInContext(readFileSync(join(ROOT, f), "utf8").replace(/^const /gm, "var "), ctx);

let failed = 0;
for (const { id, name } of JSON.parse(readFileSync(join(ROOT, "data/regions.json"), "utf8"))) {
  const map = await ctx.loadRegion(id);
  const lm = ctx.pickLandmarks(map);
  const groups = new Set(lm.map((l) => ctx.SOUND_TYPES[l.type].group));
  let ok = 0, worst = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    try {
      const r = ctx.pickRoutes(map, lm, ctx.makeRng(seed));
      ok++;
      worst = Math.max(worst, Math.abs(r[0].shortestMeters - r[1].shortestMeters) / Math.max(r[0].shortestMeters, r[1].shortestMeters));
    } catch (e) { /* 실패로 센다 */ }
  }
  if (ok < seeds || lm.length < 3) failed++;
  console.log(`${name.padEnd(5)} 소리: ${lm.map((l) => l.type).join(", ").padEnd(32)} 음색 겹침: ${groups.size < lm.length ? "있음" : "없음"}  경로 ${ok}/${seeds} 성공, 두 판 길이 차이 최대 ${(worst * 100).toFixed(0)}%`);
}
process.exit(failed ? 1 : 0);
