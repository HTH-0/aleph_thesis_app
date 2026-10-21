// 끊김 재기: "출발" 버튼을 누른 뒤 판 화면이 준비되기까지 걸린 시간과, 판을 시작한 뒤 걸으며 생긴 끊김(프레임 간격 70ms 넘음. 헤드리스 Chrome은 간격이 16.7ms 단위라 30fps 안팎에서는 33·50ms가 번갈아 나온다),
// 판 도중 새로 만든 셰이더 수를 찍는다. 셰이더를 처음 그릴 때 만들면 그 프레임이 0.1~0.2초 멈춘다 (js/game.js warmUp)
// 먼저 서버를 띄운다: node tools/check/serve.mjs (또는 review.mjs)
// 실행: CHECK_GPU=1 node tools/check/hitch.mjs [지역,…]
import { openBrowser, sleep } from "./browser.mjs";

const regions = (process.argv[2] || "jamsil,worldcup,banwoldang,seomun").split(",");
const base = process.env.APP_URL || "http://127.0.0.1:8765/index.html";
let port = 9510, bad = 0;
for (const region of regions) {
  const b = await openBrowser(port++);
  const q = process.env.CHECK_QUALITY ? `&quality=${process.env.CHECK_QUALITY}` : "";
  await b.send("Page.navigate", { url: `${base}?test=1&seed=5&region=${region}${q}` });
  for (let i = 0; i < 40 && !(await b.ev(`!document.getElementById("btn-start").disabled`)); i++) await sleep(500);
  await b.ev(`document.getElementById("btn-start").click()`);
  await sleep(1200);
  // 출발 버튼부터 판 화면 준비까지 (지도 그리기, 행인·차, 셰이더 미리 만들기)
  const t0 = Date.now();
  await b.ev(`document.getElementById("btn-go").click()`);
  for (let i = 0; i < 200 && !(await b.ev("!!(window.__play && window.__play.perf)")); i++) await sleep(50);
  const ready = Date.now() - t0;
  await sleep(4000);
  await b.ev(`document.getElementById("play-overlay").click()`);
  await sleep(1000);
  const p0 = ((await b.ev("window.__play.perf()")).programs || 0);
  await b.ev(`(() => { window.__ft = []; let last = performance.now(); const f = (t) => { window.__ft.push(t - last); last = t; if (window.__ft.length < 5000) requestAnimationFrame(f); }; requestAnimationFrame(f); })()`);
  for (let k = 0; k < 4; k++) { await b.key("KeyW", true); await sleep(4000); await b.key("KeyW", false); await b.key("ArrowLeft", true); await sleep(600); await b.key("ArrowLeft", false); }
  // 지하도 입구 번호판처럼 판 도중 처음 보이는 물체도 보게 한다
  const up = await b.ev("window.__play.underpass()");
  if (up) { const e = up[0]; await b.ev(`window.__play.teleport(${e.mouth.x + e.tx * 6}, ${e.mouth.z + e.tz * 6}, ${Math.atan2(e.tx, e.tz)})`); await sleep(1500); }
  const p1 = ((await b.ev("window.__play.perf()")).programs || 0);
  const ft = (await b.ev("window.__ft")).slice(3), s = [...ft].sort((a, c) => a - c), pc = (x) => s[Math.floor(s.length * x)].toFixed(0);
  const spikes = ft.filter((d) => d > 70);
  if (p1 > p0) bad++;
  console.log(`[${region}] 준비 ${(ready / 1000).toFixed(1)}초 · 프레임 ${ft.length} · 간격 중간 ${pc(0.5)}ms, 99% ${pc(0.99)}ms, 최대 ${s[s.length - 1].toFixed(0)}ms · 70ms 넘는 끊김 ${spikes.length}회 · 판 도중 새 셰이더 ${p1 - p0}개`);
  b.close();
}
process.exit(bad ? 1 : 0);
