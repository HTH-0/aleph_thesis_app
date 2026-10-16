// 검증용 정적 서버. 실행: node tools/check/serve.mjs [포트, 기본 8765]
// 저장소 폴더만 내보내고, 그 밖의 경로 요청은 거절한다.
import http from "node:http";
import { readFile } from "node:fs";
import { join, extname, resolve } from "node:path";
import { ROOT } from "./browser.mjs";

const port = Number(process.argv[2]) || 8765;
const types = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".json": "application/json", ".mp3": "audio/mpeg", ".png": "image/png" };
const root = resolve(ROOT);
http.createServer((req, res) => {
  const p = resolve(join(root, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html")));
  if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
  readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": types[extname(p)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}/index.html 에서 저장소 폴더를 내보냅니다 (Ctrl+C로 끝냄)`));
