// 행인 모델을 가까이에서 찍는다: 같은 사람의 원본 옷과 바꾼 옷, 신호를 기다리는 사람
// 먼저 서버를 띄운다: node tools/check/serve.mjs (또는 review.mjs)
// 실행: CHECK_GPU=1 node tools/check/peds.mjs [지역, 기본 jamsil]   → tools/check/out/peds-<지역>-*.png
import { openBrowser, sleep, OUT } from "./browser.mjs";

const region = process.argv[2] || "jamsil";
const b = await openBrowser(9412);
await b.startRound(region, { seed: 5 });
await sleep(8000);
// 사람 앞 d m에서 그 사람을 바라본다 (행인 yaw는 걷는 방향, 카메라 yaw는 그 반대쪽을 본다)
async function look(model, name, d = 3, side = 0) {
  await b.ev("window.__play.freeze(true)"); // 찍는 동안 멈춘다
  const q = (await b.ev("window.__play.peds()")).find((o) => o.model === model);
  if (!q) { await b.ev("window.__play.freeze(false)"); return console.log(name, "그 사람이 지금 없음"); }
  const fx = Math.sin(q.yaw), fz = Math.cos(q.yaw);
  const cx = q.x + fx * d - fz * side, cz = q.z + fz * d + fx * side; // side: 옆으로 비켜 선다 (기둥에 가리지 않게)
  await b.ev(`window.__play.view(${cx}, ${cz}, 2.2, ${Math.atan2(cx - q.x, cz - q.z)}, -0.22)`);
  await sleep(400);
  console.log(name, JSON.stringify(q), await b.shot(`peds-${region}-${name}`));
  await b.ev("window.__play.freeze(false)");
}
const ps = await b.ev("window.__play.peds()");
// 자리 번호를 6으로 나눈 나머지가 같으면 같은 사람, 6 이상이면 바꾼 옷 (js/people.js, traffic.js의 자리 배정)
const varied = ps.find((p) => p.model >= 6 && (!process.argv[3] || p.model % 6 === +process.argv[3]) && ps.some((q) => q.model === p.model % 6));
if (varied) { await look(varied.model, "variant"); await look(varied.model % 6, "original"); }
for (let t = 0; t < 30; t++) {
  const w = (await b.ev("window.__play.peds()")).find((p) => p.state === "wait");
  if (w) { await sleep(2000); await look(w.model, "waiting", 4, 2); break; }
  await sleep(2000);
}
b.close();
console.log(`스크린샷: ${OUT}`);
