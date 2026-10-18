// 행인 모델 원본을 Microsoft Rocketbox 저장소(MIT 라이선스)에서 참고자료/rocketbox/에 받는다 (원본은 저장소에 넣지 않는다).
// 실행: node tools/fetch_people.mjs
// 사람은 얼굴을 보고 고른 동아시아인 6명이다(진행.md "맥북 세션 결정"). 텍스처는 색·투명도 지도만 받는다(요철·반사 지도는 웹에서 쓰지 않는다).
// 웹용 변환은 tools/convert_people.mjs가 한다.
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "참고자료", "rocketbox");
const RAW = "https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/";
export const PEOPLE = ["Professions/Business_Female_03", "Professions/Business_Male_02", "Professions/Chef_Female_01", "Adults/Female_Adult_03", "Adults/Male_Adult_09", "Adults/Male_Adult_10"];
// 동작 (남녀 따로). "폴더/이름": xy는 제자리 걷기, static은 서 있는 동작(신호 기다리기: 숨쉬기, 두리번거리기, 휴대폰 문자 보기)
export const ANIMS = ["xy/m_walk_neutral_01", "xy/m_walk_neutral_02", "xy/m_walk_slow_01", "xy/f_walk_neutral_01", "xy/f_walk_neutral_02", "xy/f_walk_slow_01",
  "static/m_idle_breathe_01", "static/m_idle_look_around_01", "static/m_cell_phone_textmessage",
  "static/f_idle_breathe_01", "static/f_idle_look_around_01", "static/f_cell_phone_textmessage"];
export const animPath = (a) => `Animations/all_animations_max_motextr_${a.split("/")[0]}/${a.split("/")[1]}.max.fbx`;

// convert_people.mjs가 목록만 불러 쓸 때는 받지 않는다
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
const tree = await (await fetch("https://api.github.com/repos/microsoft/Microsoft-Rocketbox/git/trees/master?recursive=1", { headers: { "User-Agent": "sound-walk" } })).json();
const paths = tree.tree.filter((t) => t.type === "blob").map((t) => t.path);
const want = [];
for (const p of PEOPLE) {
  const base = `Assets/Avatars/${p}/`, name = p.split("/")[1];
  want.push(`${base}Export/${name}.fbx`, ...paths.filter((q) => q.startsWith(base + "Textures/") && /_(color)\.tga$/.test(q)));
}
for (const a of ANIMS) want.push("Assets/" + animPath(a));
want.push("LICENSE.md");
let n = 0, bytes = 0;
for (const p of want) {
  const dest = join(OUT, p.replace(/^Assets\//, ""));
  if (existsSync(dest)) continue;
  const res = await fetch(RAW + p);
  if (!res.ok) { console.log("실패", p, res.status); continue; }
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  n++; bytes += buf.length;
}
console.log(`받음 ${n}개 ${(bytes / 1e6).toFixed(0)}MB → ${OUT}`);
}
