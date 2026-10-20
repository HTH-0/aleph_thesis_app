// 출발점·목적지와 소리 장소의 관계를 지역마다 시드 여러 개로 잰다 (js/world.js pickRoutes의 RULES)
// 실행: node tools/check/soundroutes.mjs [시드 수, 기본 200]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { ROOT } from "./browser.mjs";

const seeds = Number(process.argv[2]) || 200;
const ctx = { console, Math, Uint8Array, Int32Array, Array, Error, JSON, encodeURIComponent, Number, Set, Map };
ctx.fetch = async (url) => { try { return { ok: true, json: async () => JSON.parse(readFileSync(join(ROOT, url), "utf8")) }; } catch (e) { return { ok: false }; } };
vm.createContext(ctx);
for (const f of ["js/config.js", "js/world.js"]) vm.runInContext(readFileSync(join(ROOT, f), "utf8").replace(/^const /gm, "var "), ctx);

const pct = (a, q) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * q))]; };
for (const { id, name } of JSON.parse(readFileSync(join(ROOT, "data/regions.json"), "utf8"))) {
  const map = await ctx.loadRegion(id);
  const lm = ctx.pickLandmarks(map);
  const level = [0, 0, 0, 0, 0], len = [], nearStart = [], nearGoal = [], inGoal = [];
  let fail = 0;
  for (let s = 1; s <= seeds; s++) {
    let r;
    try { r = ctx.pickRoutes(map, lm, ctx.makeRng(s)); } catch (e) { fail++; continue; }
    for (const rt of r) {
      level[rt.soundRule]++;
      len.push(rt.shortestMeters);
      const d = (p) => lm.map((l) => Math.hypot(l.x - p.x, l.z - p.z));
      nearStart.push(Math.min(...d(rt.startPos)));
      nearGoal.push(Math.min(...d(rt.goalPos)));
      inGoal.push(d(rt.goalPos).filter((v) => v <= 300).length);
    }
  }
  const total = level.reduce((a, b) => a + b, 0) || 1;
  console.log(`[${name}] 판 ${total} (실패 시드 ${fail}) · 단계별 비율 ${level.map((v, i) => `${i}:${Math.round((v / total) * 100)}%`).join(" ")} · 최단 거리 중간 ${pct(len, 0.5)}m (${pct(len, 0.1)}~${pct(len, 0.9)}) · 가장 가까운 소리까지 출발점 중간 ${Math.round(pct(nearStart, 0.5))}m, 목적지 중간 ${Math.round(pct(nearGoal, 0.5))}m · 목적지 300m 안 소리 수 중간 ${pct(inGoal, 0.5)}`);
}
