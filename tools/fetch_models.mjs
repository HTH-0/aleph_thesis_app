// 3D 모델 원본을 Sketchfab 공식 API로 참고자료/models/<이름>/에 받는다 (저장소와 배포물에는 원본을 넣지 않는다).
// 실행: node tools/fetch_models.mjs           (전체)
//       node tools/fetch_models.mjs ioniq5    (하나만, 여러 개는 쉼표로)
// Sketchfab API 토큰은 저장소 맨 위 .env의 SKETCHFAB_TOKEN(또는 같은 이름의 환경 변수)에서 읽는다.
// 받기 직전에 모델마다 라이선스가 CC BY인지, 다운로드가 열려 있는지 다시 확인하고, 다르면 받지 않고 알린다.
// 모델을 고른 기준(직접 만든 것이 확인되는 것만, 상표·낙서·실제 인물 스캔 제외)은 진행.md "맥북 세션 결정"에 있다.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "참고자료", "models");
const envFile = join(ROOT, ".env");
const fromFile = existsSync(envFile) ? (readFileSync(envFile, "utf8").match(/^SKETCHFAB_TOKEN=(.*)$/m) || [])[1] : null;
const TOKEN = (process.env.SKETCHFAB_TOKEN || fromFile || "").trim();
if (!TOKEN) { console.error(".env에 SKETCHFAB_TOKEN=... 을 넣어 주세요."); process.exit(1); }

// 이름: Sketchfab 모델 uid. note는 쓰임새
export const MODELS = {
  ioniq5: { uid: "675e78311e8440d88714bd212cb7a8fb", note: "승용차·택시(현대 로고 지움)" },
  soul: { uid: "a29232f2dcba4424a8d62e5bf1474bc1", note: "골목 승용차(기아 로고 지움)" },
  tucson: { uid: "7674a3bd168a451daf73fc0a33d39589", note: "주차된 SUV(현대 로고 지움)" },
  lct3000: { uid: "3be03b6a43aa41898c9ca806b8787052", note: "브랜드 없는 탑차" },
  milano95: { uid: "122a22d210234596ad23623588d0d166", note: "브랜드 없는 90년대 해치백" },
  bicycle: { uid: "da6507928c0c4a5c8776008cdb9f747e", note: "자전거" },
  bikestand: { uid: "597656d383f94bca8fa098905a126ee1", note: "자전거 거치대" },
  scooter: { uid: "e22bffc784b04a93acc83599fa7a81c0", note: "공유 전동킥보드(로고 있으면 지움)" },
  cones: { uid: "e03b1d2dfdc0416bb8324d15573ea60c", note: "라바콘·바리케이드" },
  bus: { uid: "c4b2c122327f431cb5269de97328f7e1", note: "시내버스 후보(받아서 지금 버스와 비교)" },
};
// 다른 게임에서 빼 온 모델로 보이는 표시 (태그·설명)
const RIP = /notmymodel|not my model|ripped|extracted|export(ed)? from|cities:? ?skylines|bussid|gta ?v|forza/i;

const api = async (path, auth) => {
  const res = await fetch(`https://api.sketchfab.com/v3${path}`, { headers: auth ? { Authorization: `Token ${TOKEN}` } : {} });
  return { status: res.status, body: res.ok ? await res.json() : await res.text() };
};

const only = process.argv[2] ? process.argv[2].split(",") : Object.keys(MODELS);
const done = [], skipped = [];
for (const name of only) {
  const m = MODELS[name];
  if (!m) { skipped.push([name, "목록에 없는 이름"]); continue; }
  const info = await api(`/models/${m.uid}`);
  if (info.status !== 200) { skipped.push([name, `모델 정보를 못 읽음(HTTP ${info.status})`]); continue; }
  const d = info.body, lic = d.license || {};
  const text = [...(d.tags || []).map((t) => t.name), d.description || ""].join(" ");
  if (lic.slug !== "by") { skipped.push([name, `라이선스가 CC BY가 아님: ${lic.label || "없음"}`]); continue; }
  if (!d.isDownloadable) { skipped.push([name, "다운로드가 닫혀 있음"]); continue; }
  if (RIP.test(text)) { skipped.push([name, "다른 게임에서 빼 온 모델로 보이는 표시가 있음"]); continue; }
  const dl = await api(`/models/${m.uid}/download`, true);
  if (dl.status !== 200) { skipped.push([name, `다운로드 주소를 못 받음(HTTP ${dl.status})`]); continue; }
  // glb(파일 하나)가 있으면 그것을, 없으면 glTF 묶음(zip)을 받는다
  const pick = dl.body.glb ? ["glb", dl.body.glb] : dl.body.gltf ? ["zip", dl.body.gltf] : null;
  if (!pick) { skipped.push([name, "glb·glTF 형식이 없음"]); continue; }
  const res = await fetch(pick[1].url);
  if (!res.ok) { skipped.push([name, `파일 받기 실패(HTTP ${res.status})`]); continue; }
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = join(OUT, name);
  mkdirSync(dir, { recursive: true });
  const file = `${name}.${pick[0]}`;
  writeFileSync(join(dir, file), buf);
  writeFileSync(join(dir, "source.json"), JSON.stringify({
    name: d.name, uid: m.uid, author: d.user.displayName, authorUrl: d.user.profileUrl, url: d.viewerUrl,
    license: lic.label, licenseUrl: lic.url || "https://creativecommons.org/licenses/by/4.0/", faces: d.faceCount, note: m.note,
    file, bytes: buf.length, fetchedAt: new Date().toISOString().slice(0, 10),
  }, null, 1));
  done.push([name, `${d.name} (${d.user.displayName}) · ${lic.label} · ${file} ${(buf.length / 1e6).toFixed(1)}MB`]);
}
for (const [n, s] of done) console.log("받음 ", n.padEnd(10), s);
for (const [n, s] of skipped) console.log("안 받음", n.padEnd(10), s);
console.log(`저장 위치: ${OUT}`);
