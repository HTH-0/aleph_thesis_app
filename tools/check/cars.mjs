// 차종마다 한 대씩 비스듬히 앞에서 찍는다 (모양, 방향, 색, 택시 표시등, 땅에 붙어 있는지)
// 먼저 서버를 띄운다: node tools/check/serve.mjs (또는 review.mjs)
// 실행: CHECK_GPU=1 node tools/check/cars.mjs [지역, 기본 banwoldang]   → tools/check/out/cars-<지역>-<차종>.png
import { openBrowser, sleep, OUT } from "./browser.mjs";

const region = process.argv[2] || "banwoldang";
const b = await openBrowser(9415);
await b.startRound(region, { seed: 5 });
const seen = new Set();
for (let t = 0; t < 12 && seen.size < 7; t++) {
  await sleep(4000);
  await b.ev("window.__play.freeze(true)");
  for (const c of await b.ev("window.__play.cars()")) {
    const key = c.taxi ? "taxi" : c.model;
    if (seen.has(key) || c.y > 1) continue;
    seen.add(key);
    // 차 앞쪽 비스듬히 7m, 높이 2.5m에서 차를 본다
    const fx = Math.sin(c.yaw + 0.6), fz = Math.cos(c.yaw + 0.6), cx = c.x + fx * 7, cz = c.z + fz * 7;
    await b.ev(`window.__play.view(${cx}, ${cz}, 2.5, ${Math.atan2(cx - c.x, cz - c.z)}, -0.25)`);
    await sleep(400);
    console.log(key, JSON.stringify(c), await b.shot(`cars-${region}-${key}`));
  }
  await b.ev("window.__play.freeze(false)");
}
console.log("찍은 차종:", [...seen].join(", "), JSON.stringify(await b.ev("window.__play.perf()")));
b.close();
console.log(`스크린샷: ${OUT}`);
