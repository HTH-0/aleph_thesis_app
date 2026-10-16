// 한 지역에서 거리 화면을 찍는다: 가장 넓은 횡단보도 앞, 큰길 보도, 지도 끝 가림막, 그리고 큰 차도로 걸어 들어가기와 가림막 부딪히기
// 먼저 서버를 띄운다: node tools/check/serve.mjs
// 실행: node tools/check/views.mjs <지역, 기본 banwoldang>
import { openBrowser, sleep, OUT } from "./browser.mjs";

const region = process.argv[2] || "banwoldang";
const b = await openBrowser(9402);
await b.startRound(region, { briefShot: `${region}-brief` });
const P = (expr) => b.ev(`window.__play.${expr}`);
console.log(`[${region}] 횡단보도 ${(await P("crossings")).length}곳, 거리`, JSON.stringify(await P("traffic()")));

// 1) 가장 넓은 길의 횡단보도: 보도에 서서 건너편을 본다
const xs = await P("crossings");
if (xs.length) {
  // 지도 끝에서 60m 넘게 떨어진 횡단보도 가운데 가장 넓은 길의 것 (지도 한 변은 840m)
  const inner = xs.filter((q) => q.x > 60 && q.z > 60 && q.x < 780 && q.z < 780);
  const c = (inner.length ? inner : xs).slice().sort((a, b2) => b2.w - a.w)[0];
  const n = [-c.tz, c.tx], r = c.w / 2 + 3.5;
  await P(`teleport(${c.x + n[0] * r}, ${c.z + n[1] * r}, ${Math.atan2(n[0], n[1])})`); await sleep(6000);
  await b.shot(`${region}-crossing`);
  // 2) 같은 길을 따라 본다
  await P(`teleport(${c.x + n[0] * r + c.tx * 25}, ${c.z + n[1] * r + c.tz * 25}, ${Math.atan2(-c.tx, -c.tz)})`); await sleep(5000);
  await b.shot(`${region}-street`);
  // 3) 횡단보도가 아닌 곳에서 차도 쪽으로 걸어 본다: 걷는 칸(2)에 남아 있어야 한다
  await P(`teleport(${c.x + n[0] * r + c.tx * 40}, ${c.z + n[1] * r + c.tz * 40}, ${Math.atan2(n[0], n[1])})`); await sleep(800);
  await b.key("KeyW", true); await sleep(4000); await b.key("KeyW", false);
  const pos = await P("pos()");
  console.log("  차도로 걸어 들어가기:", JSON.stringify(pos), "칸 종류", await P(`kind(${pos.x}, ${pos.z})`), "(3이 아니면 통과: 1=건물 칸, 2=걷는 칸, 3=큰 차도, -1=지도 밖)");
}
// 4) 가장 넓은 지도 끝 출구: 40m 안쪽에서 바깥을 보고, 4m 안쪽에서 걸어가 가림막에 부딪힌다
const ex = (await P("exits")).slice().sort((a, b2) => b2.width - a.width)[0];
if (ex) {
  const yaw = Math.atan2(ex.inward[0], ex.inward[1]);
  await P(`teleport(${ex.x + ex.inward[0] * 40}, ${ex.z + ex.inward[1] * 40}, ${yaw})`); await sleep(4000);
  await b.shot(`${region}-edge`);
  await P(`teleport(${ex.x + ex.inward[0] * 4}, ${ex.z + ex.inward[1] * 4}, ${yaw})`); await sleep(1000);
  await b.key("KeyW", true); await sleep(5000);
  console.log("  가림막 안내 문구:", (await b.ev(`!document.getElementById("play-toast").hidden`)) ? "보임" : "안 보임");
  await b.shot(`${region}-edge-bump`);
  await b.key("KeyW", false);
}
b.close();
console.log(`스크린샷: ${OUT}`);
