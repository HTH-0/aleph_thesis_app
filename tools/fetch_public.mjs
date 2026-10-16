// 지도 생성에 쓰는 공공데이터 원본(로그인 없이 받을 수 있는 것)을 참고자료/공공데이터/에 받는다.
// 실행: node tools/fetch_public.mjs
// 원본 파일은 저장소와 배포물에 넣지 않는다(.gitignore의 참고자료/). 출처는 참고자료/공공데이터/출처.txt에 남긴다.
// 브이월드 GIS건물통합정보는 로그인이 필요해서 여기서 받지 않는다(진행.md "남은 일" 참고).
import { writeFileSync, mkdirSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "참고자료", "공공데이터");
const UA = { "User-Agent": "Mozilla/5.0 (sound-walk map builder)" };

// zip 안의 파일 목록을 읽는다 (저장, deflate 방식만). 반환: [{ name: Buffer(원래 바이트), data() }]
function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("zip 끝 표지를 찾지 못했습니다");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let k = 0; k < count; k++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen);
    out.push({
      name,
      data() {
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(start, start + csize);
        if (method === 0) return Buffer.from(raw);
        if (method === 8) return inflateRawSync(raw);
        throw new Error("지원하지 않는 압축 방식: " + method);
      },
    });
    p += 46 + nlen + elen + clen;
  }
  return out;
}
// 이름 바이트가 prefix(ASCII)로 시작하는 항목
const byPrefix = (entries, prefix) => entries.filter((e) => e.name.toString("latin1").split("/").pop().startsWith(prefix));

async function seoulCrosswalk() {
  // 서울 열린데이터광장 OA-15554 "횡단보도 위치 및 부착대 정보.zip" (seq=10). 안쪽 A004_A_*.zip이 횡단보도 면이다
  const page = await (await fetch("https://data.seoul.go.kr/dataList/OA-15554/S/1/datasetView.do", { headers: UA })).text();
  // 페이지에 infSeq가 여러 개 있으므로 파일 다운로드 양식(frmFile) 안의 값을 쓴다
  const form = page.slice(Math.max(0, page.indexOf('name="frmFile"')));
  const infSeq = (form.match(/name="infSeq" value="(\d+)"/) || [])[1] || "3";
  const seq = (page.match(/downloadFile\('(\d+)'\);">횡단보도 위치/) || [])[1] || "10";
  const res = await fetch("https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false", {
    method: "POST",
    headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded", Referer: "https://data.seoul.go.kr/dataList/OA-15554/S/1/datasetView.do" },
    body: new URLSearchParams({ infId: "OA-15554", infSeq, seq }).toString(),
  });
  if (!res.ok) throw new Error("서울 횡단보도 다운로드 실패: " + res.status);
  const outer = unzip(Buffer.from(await res.arrayBuffer()));
  const innerZip = byPrefix(outer, "A004_A")[0];
  if (!innerZip) throw new Error("서울 zip 안에서 A004_A 파일을 찾지 못했습니다");
  const dir = join(OUT, "seoul_crosswalk");
  mkdirSync(dir, { recursive: true });
  for (const e of byPrefix(unzip(innerZip.data()), "A004_A.")) writeFileSync(join(dir, e.name.toString("latin1").split("/").pop()), e.data());
  return { dir, page: "https://data.seoul.go.kr/dataList/OA-15554/S/1/datasetView.do" };
}

async function daeguCrosswalk() {
  // 공공데이터포털 15029067 "대구광역시_횡단보도". 사이트의 다운로드 순서(파일 번호 조회 → 다운로드 횟수 확인 → 받기)를 따른다.
  // 다운로드 횟수 제한에 걸려 보안문자를 요구하면 멈추고, 사람이 브라우저에서 받도록 안내한다.
  const pageUrl = "https://www.data.go.kr/data/15029067/fileData.do";
  const jar = [];
  const keep = (r) => { const c = r.headers.getSetCookie ? r.headers.getSetCookie() : []; for (const x of c) jar.push(x.split(";")[0]); };
  const hdr = () => ({ ...UA, Referer: pageUrl, Cookie: jar.join("; ") });
  const page = await fetch(pageUrl, { headers: UA }); keep(page);
  const html = await page.text();
  const m = html.match(/fn_fileDataDown\('(\d+)', '([^']+)', '([^']*)','(\d+)'/);
  if (!m) throw new Error("대구 횡단보도 페이지에서 파일 정보를 찾지 못했습니다");
  const q = new URLSearchParams({ publicDataDetailPk: m[2], publicDataPk: m[1], atchFileId: m[3], fileDetailSn: m[4], publicDataTyCode: "PR0051" });
  const t = await fetch("https://www.data.go.kr/tcs/dss/selectFileDataDownload.do?" + q, { headers: { ...hdr(), "X-Requested-With": "XMLHttpRequest" } }); keep(t);
  const info = JSON.parse(await t.text());
  if (!info.status) throw new Error("대구 횡단보도 파일 번호를 받지 못했습니다");
  const lim = await fetch("https://www.data.go.kr/cmm/cmm/check-limit.json", {
    method: "POST", headers: { ...hdr(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ atchFileId: info.atchFileId, fileDetailSn: info.fileDetailSn }).toString(),
  }); keep(lim);
  if (JSON.parse(await lim.text()).needCaptcha) throw new Error("공공데이터포털이 보안문자를 요구합니다. 브라우저에서 " + pageUrl + " 를 열어 직접 받아 주세요.");
  const name = info.dataSetFileDetailInfo && info.dataSetFileDetailInfo.dataNm;
  const res = await fetch(`https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=${info.atchFileId}&fileDetailSn=${info.fileDetailSn}&dataNm=${encodeURI(name || "")}`, { headers: hdr() });
  if (!res.ok) throw new Error("대구 횡단보도 다운로드 실패: " + res.status);
  const dir = join(OUT, "daegu_crosswalk");
  mkdirSync(dir, { recursive: true });
  const files = unzip(Buffer.from(await res.arrayBuffer())).filter((e) => /\.(shp|shx|dbf|prj|cpg)$/i.test(e.name.toString("latin1")));
  for (const e of files) writeFileSync(join(dir, e.name.toString("latin1").split("/").pop()), e.data());
  return { dir, page: pageUrl, file: name, names: files.map((e) => e.name.toString("latin1").split("/").pop()) };
}

const today = new Date().toISOString().slice(0, 10);
mkdirSync(OUT, { recursive: true });
const s = await seoulCrosswalk();
console.log("서울 횡단보도:", s.dir);
const d = await daeguCrosswalk();
console.log("대구 횡단보도:", d.dir, d.names.join(", "));
const base = d.names.find((n) => /\.shp$/i.test(n)).replace(/\.shp$/i, "");
if (base !== "A0043325") console.warn(`대구 파일 이름이 바뀌었습니다(${base}). tools/build_maps.mjs의 PUBLIC_CROSSWALKS.daegu.file을 "daegu_crosswalk/${base}"로 고쳐 주세요.`);
writeFileSync(join(OUT, "출처.txt"), `이 폴더의 파일은 지도 생성(tools/build_maps.mjs)에만 쓰고, 저장소와 배포물에는 넣지 않는다.
tools/fetch_public.mjs가 ${today}에 다시 받았다.

seoul_crosswalk/A004_A.*
  서울시 교통안전시설물 횡단보도 정보 (서울 열린데이터광장 OA-15554), 공공누리 제1유형(출처표시)
  ${s.page}
  좌표계 EPSG:5186

daegu_crosswalk/${base}.*
  ${d.file} (공공데이터포털 15029067), 이용허락범위 제한 없음
  ${d.page}
  좌표계는 .prj 파일을 따른다 (2023-08-16 파일은 EPSG:5187)

(사용자가 넣을 파일) GIS건물통합정보 SHP: 서울특별시, 대구광역시
  국토교통부 GIS건물통합정보, 공공누리 제1유형(출처표시), 브이월드 로그인 필요
  https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=18
`);
console.log("출처 기록:", join(OUT, "출처.txt"));
