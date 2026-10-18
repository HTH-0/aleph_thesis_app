// Rocketbox 사람 FBX(참고자료/rocketbox/)를 웹용 glb(assets/people/)로 바꾼다. 헤드리스 Chrome 안에서 three.js로 읽고 다시 저장한다.
// 먼저: node tools/fetch_people.mjs 로 원본을 받고, 다른 터미널에서 node tools/check/serve.mjs (또는 review.mjs)를 띄운다.
// 실행: node tools/convert_people.mjs
// 사람마다 성별에 맞는 걷기 동작 3개를 함께 넣는다. 텍스처는 몸·머리 1024px JPEG, 머리카락 등 투명한 부분은 512px PNG.
import { writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { openBrowser, sleep, ROOT } from "./check/browser.mjs";
import { PEOPLE, ANIMS, animPath } from "./fetch_people.mjs";

const OUT = join(ROOT, "assets", "people");
const HOST = (process.env.APP_URL || "http://127.0.0.1:8765/index.html").replace(/\/index\.html$/, "");
const b = await openBrowser(9407);
await b.send("Page.navigate", { url: `${HOST}/tools/convert_people.html` });
for (let i = 0; i < 40 && !(await b.ev("typeof window.convert === 'function' && typeof THREE.GLTFExporter === 'function'")); i++) await sleep(500);
mkdirSync(OUT, { recursive: true });
const male = (p) => /Male/.test(p) && !/Female/.test(p);
for (const p of PEOPLE) {
  const name = p.split("/")[1];
  const fbx = encodeURI(`/참고자료/rocketbox/Avatars/${p}/Export/${name}.fbx`);
  // 걷기 동작은 남녀 첫 사람 파일에만 넣는다. 뼈 이름이 모두 같아서 게임에서 그 동작을 다른 사람에게도 쓴다
  const first = PEOPLE.find((q) => male(q) === male(p)) === p;
  const anims = !first ? [] : ANIMS.filter((a) => a.split("/")[1].startsWith(male(p) ? "m_" : "f_")).map((a) => encodeURI(`/참고자료/rocketbox/${animPath(a)}`));
  const tex = encodeURI(`/참고자료/rocketbox/Avatars/${p}/Textures/`);
  const b64 = await b.ev(`convert(${JSON.stringify(fbx)}, ${JSON.stringify(anims)}, ${JSON.stringify(tex)}).catch(e => "ERR " + e.message)`);
  if (!b64 || b64.startsWith("ERR")) { console.log("실패", name, b64); continue; }
  const file = join(OUT, name + ".glb");
  writeFileSync(file, Buffer.from(b64, "base64"));
  // 겹친 꼭짓점 합치기, 숫자 정밀도 줄이기(KHR_mesh_quantization), 동작의 불필요한 키 줄이기, 안 쓰는 데이터 지우기
  for (const step of ["weld", "quantize", "resample", "dedup", "prune"])
    execFileSync("npx", ["-y", "@gltf-transform/cli@4.1.1", step, file, file], { stdio: "ignore" });
  console.log(`${name}.glb ${(statSync(file).size / 1e6).toFixed(2)}MB${anims.length ? ` (동작 ${anims.length}개 포함)` : ""}`);
}
b.close();
