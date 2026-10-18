// 검증 스크립트가 함께 쓰는 헤드리스 Chrome 제어 (Chrome DevTools Protocol, 외부 패키지 없음)
// Chrome 위치는 환경 변수 CHROME_PATH로 바꿀 수 있다.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const OUT = join(ROOT, "tools", "check", "out"); // 스크린샷과 브라우저 프로필 (.gitignore 대상)
export const BASE = process.env.APP_URL || "http://127.0.0.1:8765/index.html";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chromePath() {
  const cands = [process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
  const p = cands.find((c) => existsSync(c));
  if (!p) throw new Error("Chrome을 찾지 못했습니다. CHROME_PATH 환경 변수로 위치를 알려 주세요.");
  return p;
}

// 반환: { send, ev, shot, goto, close }
export async function openBrowser(port = 9400) {
  mkdirSync(OUT, { recursive: true });
  // 기본은 GPU 없이(SwiftShader) 그린다. CHECK_GPU=1이면 이 컴퓨터의 GPU로 그려서 실제에 가까운 fps를 잰다
  const gl = process.env.CHECK_GPU === "1" ? ["--enable-gpu", "--ignore-gpu-blocklist"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
  const chrome = spawn(chromePath(), ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${join(OUT, "profile-" + port)}`,
    ...gl, "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required", "--mute-audio",
    "--window-size=1280,760", "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(500);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch { /* 아직 안 떴다 */ }
  }
  if (!target) throw new Error("Chrome 디버깅 포트에 연결하지 못했습니다");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result || d.error); pending.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") console.log("  예외:", (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || "").split("\n").slice(0, 3).join(" | "));
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") console.log("  콘솔 오류:", d.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 200));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 760, deviceScaleFactor: 1, mobile: false });
  return {
    send, ev,
    async shot(name) { const s = await send("Page.captureScreenshot", { format: "png" }); const f = join(OUT, name + ".png"); writeFileSync(f, Buffer.from(s.data, "base64")); return f; },
    async key(code, down) { return send("Input.dispatchKeyEvent", { type: down ? "rawKeyDown" : "keyUp", code, key: code.replace(/^Key/, "").toLowerCase() }); },
    // 테스트 모드로 지역을 열고 첫 판을 시작한다 (출발 전 지도 → 출발 → 화면 클릭)
    async startRound(region, { seed = 3, briefShot = null } = {}) {
      const q = process.env.CHECK_QUALITY ? `&quality=${process.env.CHECK_QUALITY}` : ""; // 그래픽 품질 low·medium·high
      await send("Page.navigate", { url: `${BASE}?test=1&seed=${seed}&region=${region}${q}` });
      for (let i = 0; i < 40 && !(await ev(`!document.getElementById("btn-start").disabled`)); i++) await sleep(500);
      await ev(`document.getElementById("btn-start").click()`);
      await sleep(1200);
      if (briefShot) await this.shot(briefShot);
      await ev(`document.getElementById("btn-go").click()`);
      await sleep(7000);
      await ev(`document.getElementById("play-overlay").click()`);
      await sleep(1500);
    },
    close() { ws.close(); chrome.kill(); },
  };
}
