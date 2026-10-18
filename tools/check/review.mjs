// 지도 검수 화면 서버. 우리 지도와 카카오 스카이뷰·로드뷰를 나란히 띄우고, 사람이 남긴 판정을 저장한다.
// 실행: node tools/check/review.mjs [포트, 기본 8765] → http://127.0.0.1:8765/review
// 카카오 JavaScript 키는 저장소 맨 위 .env의 KAKAO_JS_KEY(또는 같은 이름의 환경 변수)에서 읽는다. .env는 커밋하지 않는다.
// 카카오 개발자 콘솔에서 이 주소(http://127.0.0.1:포트, http://localhost:포트)를 JavaScript SDK 도메인으로 등록해야 지도가 뜬다.
// 판정 기록: tools/check/out/review_checks.json (카카오 화면은 저장하지 않고, 사람이 고른 판정과 메모만 남긴다)
import http from "node:http";
import { readFile, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { ROOT, OUT } from "./browser.mjs";
import { sidewalkReport } from "./sidewalk.mjs";

const port = Number(process.argv[2]) || 8765;
const envFile = join(ROOT, ".env");
const fromFile = existsSync(envFile) ? (readFileSync(envFile, "utf8").match(/^KAKAO_JS_KEY=(.*)$/m) || [])[1] : null;
const KEY = (process.env.KAKAO_JS_KEY || fromFile || "").trim();
if (!/^[0-9a-f]{32}$/.test(KEY)) console.warn("카카오 JavaScript 키가 없거나 형식이 다릅니다. .env에 KAKAO_JS_KEY=... 를 넣어 주세요. (우리 지도만 보입니다)");

const CHECKS = join(OUT, "review_checks.json");
const loadChecks = () => (existsSync(CHECKS) ? JSON.parse(readFileSync(CHECKS, "utf8")) : []);
const reports = {};
const report = async (id) => reports[id] || (reports[id] = await sidewalkReport(id));

const types = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".json": "application/json", ".mp3": "audio/mpeg", ".png": "image/png" };
const root = resolve(ROOT);
const send = (res, code, body, type = "application/json") => { res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/review") {
      const page = readFileSync(join(ROOT, "tools", "check", "review.html"), "utf8").replace("%%KAKAO_JS_KEY%%", KEY);
      return send(res, 200, page, types[".html"]);
    }
    if (url.pathname === "/api/report") {
      const id = url.searchParams.get("region") || "";
      if (!/^[a-z]+$/.test(id) || !existsSync(join(ROOT, "data", id + ".json"))) return send(res, 404, { error: "지역이 없습니다" });
      return send(res, 200, await report(id));
    }
    if (url.pathname === "/api/checks" && req.method === "GET") return send(res, 200, loadChecks());
    if (url.pathname === "/api/checks" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) { body += chunk; if (body.length > 20000) return send(res, 413, { error: "너무 깁니다" }); }
      const c = JSON.parse(body);
      if (!c.region || !Number.isFinite(c.x) || !Number.isFinite(c.z)) return send(res, 400, { error: "region, x, z가 필요합니다" });
      const rec = { region: c.region, point: c.point || null, x: Math.round(c.x), z: Math.round(c.z), lat: c.lat, lon: c.lon,
        sidewalk: c.sidewalk || null, width: c.width || null, note: String(c.note || "").slice(0, 500), at: new Date().toISOString() };
      const all = loadChecks();
      // 같은 확인 지점을 다시 판정하면 앞의 기록을 바꾼다
      const k = rec.point ? all.findIndex((o) => o.point === rec.point) : -1;
      if (k >= 0) all[k] = rec; else all.push(rec);
      mkdirSync(OUT, { recursive: true });
      writeFileSync(CHECKS, JSON.stringify(all, null, 1));
      return send(res, 200, rec);
    }
    // 그 밖에는 저장소 파일을 내보낸다 (serve.mjs와 같다)
    const p = resolve(join(root, decodeURIComponent(url.pathname).replace(/\/$/, "/index.html")));
    // 저장소 밖, 키 파일(.env), git 기록은 내보내지 않는다
    if (!p.startsWith(root) || p.startsWith(join(root, ".env")) || p.startsWith(join(root, ".git"))) return send(res, 403, "", "text/plain");
    readFile(p, (err, data) => (err ? send(res, 404, "", "text/plain") : send(res, 200, data, types[extname(p)] || "application/octet-stream")));
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
}).listen(port, "127.0.0.1", () => console.log(`검수 화면: http://127.0.0.1:${port}/review (게임: http://127.0.0.1:${port}/ , Ctrl+C로 끝냄)`));
