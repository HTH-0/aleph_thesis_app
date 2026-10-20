// 차량이 차도 노면 밖(보도, 건물 앞)으로 나가는 비율과 화면 무게를 잰다
// 먼저 서버를 띄운다: node tools/check/serve.mjs (또는 review.mjs)
// 실행: CHECK_GPU=1 node tools/check/traffic.mjs [지역1,지역2,... 기본 전체] [지점마다 관찰 초, 기본 20]
// 지역마다 출발점과 차가 많은 횡단보도 세 곳으로 옮겨 가며 지켜본다. 차가 노면 밖에 있던 비율(offRoadPct)이 0에 가까워야 한다
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openBrowser, sleep, ROOT } from "./browser.mjs";

const all = JSON.parse(readFileSync(join(ROOT, "data/regions.json"), "utf8")).map((r) => r.id);
const regions = process.argv[2] ? process.argv[2].split(",") : all;
const secs = Number(process.argv[3]) || 20;
const b = await openBrowser(9403);
const P = (expr) => b.ev(`window.__play.${expr}`);
for (const region of regions) {
  await b.startRound(region);
  const spots = (await P("crossings")).filter((c) => c.x > 60 && c.z > 60 && c.x < 780 && c.z < 780).sort((p, q) => q.w - p.w);
  const pick = [spots[0], spots[Math.floor(spots.length / 2)], spots[spots.length - 1]].filter(Boolean);
  await sleep(secs * 1000);
  for (const c of pick) {
    const n = [-c.tz, c.tx], r = c.w / 2 + 3.5;
    await P(`teleport(${c.x + n[0] * r}, ${c.z + n[1] * r}, ${Math.atan2(n[0], n[1])})`);
    await sleep(secs * 1000);
  }
  const t = await P("traffic()"), perf = await P("perf()");
  console.log(`[${region}] 차 가운데가 차도 밖 ${t.offRoadPct}% · 차체가 연석을 넘음 ${t.bodyOffPct}% (표본 ${t.offRoadSamples}) · 교차로 통과 ${t.joins}회 중 8m 넘게 건너뜀 ${t.longJoins}회 · 막다른 길에서 사라짐 ${t.deadEnds}회 · 연석 넘은 차종 ${JSON.stringify(t.bodyOffByModel || {})} · 차 ${t.cars} · 행인 ${t.peds} · ${perf.fps} · 그리기 ${perf.calls}회 · 삼각형 ${Math.round(perf.triangles / 1000)}k`);
}
b.close();
