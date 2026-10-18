// 화면 흐름: 첫 화면 → (출발 전 지도 → 게임) × 2판 → 결과
const $ = (id) => document.getElementById(id);
const soundscape = new SoundScape();
const mapCache = {};

const SOUND_CREDITS = [
  ["경기장 함성", "LIVE Football Match – Stadium Crowd Cheering (arunangshubanerjee)", "https://pixabay.com/sound-effects/people-live-football-match-stadium-crowd-cheering-563439/"],
  ["공사장 착암기", "Jack Hammer breaking up concrete (short burst) (freesound_community)", "https://pixabay.com/sound-effects/city-jack-hammer-breaking-up-concrete-short-burst-103896/"],
  ["교회 종소리", "Single Church Bell (Universfield)", "https://pixabay.com/sound-effects/musical-single-church-bell-156463/"],
  ["절 범종", "Log Soft Low Frequency Bell Sound Temple ASMR (kalsstockmedia)", "https://pixabay.com/sound-effects/film-special-effects-log-soft-low-frequency-bell-sound-temple-asmr-309725/"],
  ["분수대 물소리", "Fountain Water Sound Effect 3 (Pixel_perfect)", "https://pixabay.com/sound-effects/nature-fountain-water-sound-effect-3-211597/"],
  ["놀이터 아이들 소리", "kids at playground short length (flutie8211)", "https://pixabay.com/sound-effects/city-kids-at-playground-short-length-478451/"],
];

const state = {
  regionId: null,
  map: null,
  landmarks: [],
  routes: [],
  order: [],     // 판마다 소리 여부 [true, false] 등
  results: [],
  round: 0,
};

function show(id) {
  for (const el of document.querySelectorAll(".screen")) el.hidden = el.id !== id;
  window.scrollTo(0, 0);
}

function setLoading(on, text) {
  $("loading").hidden = !on;
  if (text) $("loading").querySelector("p").textContent = text;
}

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
  } catch (e) {
    return false;
  }
}

// ---------- 첫 화면 ----------
async function initHome() {
  PEOPLE.load().catch((e) => console.warn("행인 모델을 불러오지 못해 단순한 모양을 씁니다:", e.message)); // 첫 화면을 보는 동안 미리 받는다
  VEHICLES.load().catch((e) => console.warn("차량 모델을 불러오지 못해 단순한 모양을 씁니다:", e.message));
  STREETPROPS.load().catch((e) => console.warn("거리 소품을 불러오지 못해 소품 없이 그립니다:", e.message));
  SCENERY.load(); // 바닥·벽 사진 텍스처 (못 불러오면 코드로 그린 무늬)
  $("paper-title").textContent = PAPER.title;
  const list = $("credit-list");
  for (const [what, name, url] of SOUND_CREDITS) {
    const li = document.createElement("li");
    li.innerHTML = `${what}: <a href="${url}" target="_blank" rel="noopener"></a>`;
    li.querySelector("a").textContent = name;
    list.appendChild(li);
  }
  $("link-credits").addEventListener("click", (e) => { e.preventDefault(); $("credits").hidden = !$("credits").hidden; });

  const fine = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
  if (!fine) $("device-warning").hidden = false;

  let vol = 0.8;
  try { const saved = parseFloat(localStorage.getItem("soundwalk.volume")); if (!Number.isNaN(saved)) vol = saved; } catch (e) {}
  $("volume").value = vol;
  soundscape.setVolume(vol);
  $("volume").addEventListener("input", (e) => {
    soundscape.setVolume(parseFloat(e.target.value));
    try { localStorage.setItem("soundwalk.volume", e.target.value); } catch (err) {}
  });

  let regions;
  try {
    const res = await fetch("data/regions.json");
    if (!res.ok) throw new Error(res.status);
    regions = await res.json();
  } catch (e) {
    showRegionError("지역 목록을 불러오지 못했습니다. README의 실행 방법(로컬 서버)으로 열었는지 확인해 주세요.");
    return;
  }
  const wrap = $("region-list");
  for (const r of regions) {
    const b = document.createElement("button");
    b.className = "region";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", "false");
    b.dataset.id = r.id;
    b.innerHTML = "<b></b><span></span>";
    b.querySelector("b").textContent = r.name;
    b.querySelector("span").textContent = r.desc;
    b.addEventListener("click", () => selectRegion(r.id));
    wrap.appendChild(b);
  }
  const fromUrl = new URLSearchParams(location.search).get("region");
  selectRegion(regions.some((r) => r.id === fromUrl) ? fromUrl : regions[0].id);

  $("btn-start").addEventListener("click", startGame);
  $("btn-go").addEventListener("click", startRound);
  $("btn-again").addEventListener("click", startGame);
  $("btn-home").addEventListener("click", () => show("screen-home"));
}

function showRegionError(msg) {
  $("region-error").textContent = msg;
  $("region-error").hidden = !msg;
}

async function selectRegion(id) {
  state.regionId = id;
  for (const b of document.querySelectorAll(".region")) b.setAttribute("aria-checked", String(b.dataset.id === id));
  $("btn-start").disabled = true;
  showRegionError("");
  $("sound-list").textContent = "불러오는 중…";
  try {
    const map = mapCache[id] || (mapCache[id] = await loadRegion(id));
    if (state.regionId !== id) return; // 그사이 다른 지역을 눌렀다
    state.map = map;
    state.landmarks = pickLandmarks(map);
    if (state.landmarks.length === 0) throw new Error("이 지역에는 소리를 낼 장소가 없습니다.");
    renderSoundChips($("sound-list"), state.landmarks);
    $("btn-start").disabled = false;
  } catch (e) {
    $("sound-list").textContent = "";
    showRegionError(e.message);
  }
}

function renderSoundChips(container, landmarks) {
  container.textContent = "";
  for (const l of landmarks) {
    const spec = SOUND_TYPES[l.type];
    const b = document.createElement("button");
    b.className = "sound-chip";
    b.innerHTML = `<i></i><span></span><small></small>`;
    b.querySelector("i").style.background = spec.color;
    b.querySelector("span").textContent = `▶ ${spec.label} ${spec.sound}`;
    b.querySelector("small").textContent = l.name || "";
    b.addEventListener("click", async () => {
      try {
        await soundscape.preview(l.type);
        if (soundscape.missing.has(l.type)) b.querySelector("small").textContent = "(소리 파일이 없어 대체음)";
      } catch (e) {
        b.querySelector("small").textContent = "재생할 수 없습니다";
      }
    });
    container.appendChild(b);
  }
}

// ---------- 게임 진행 ----------
function startGame() {
  if (!state.map) return;
  if (!hasWebGL()) {
    alert("이 브라우저에서는 3D 화면(WebGL)을 쓸 수 없습니다. 최신 Chrome이나 Edge로 열어 주세요.");
    return;
  }
  const seedParam = parseInt(new URLSearchParams(location.search).get("seed"), 10);
  const rng = makeRng(Number.isFinite(seedParam) ? seedParam : (Date.now() ^ (Math.random() * 1e9)));
  try {
    state.routes = pickRoutes(state.map, state.landmarks, rng);
  } catch (e) {
    showRegionError(e.message);
    return;
  }
  state.order = rng() < 0.5 ? [false, true] : [true, false];
  state.results = [];
  state.round = 0;
  try { soundscape.ensureContext(); } catch (e) { /* 소리 없이도 진행한다 */ }
  state.landmarks.forEach((l) => soundscape.load(l.type).catch(() => {}));
  showBriefing();
}

function showBriefing() {
  const withSound = state.order[state.round];
  $("brief-kicker").textContent = `${state.round + 1}판 / 2판 · ${state.map.name}`;
  $("brief-title").textContent = withSound ? "이번 판은 소리가 들립니다" : "이번 판은 소리가 없습니다";
  $("brief-desc").textContent = withSound
    ? "지도에서 장소 위치를 기억해 두세요. 걷는 동안 그 장소에서 소리가 납니다. 소리가 커지는 쪽, 작아지는 쪽을 단서로 쓰세요."
    : "장소 위치는 지도에만 보이고, 걷는 동안 소리는 나지 않습니다. 기억만으로 목적지를 찾아 보세요.";
  const box = $("brief-sounds");
  box.textContent = "";
  if (withSound) renderSoundChips(box, state.landmarks);
  drawBriefMap($("brief-map"), state.map, state.routes[state.round], state.landmarks);
  show("screen-briefing");
}

function drawBriefMap(canvas, map, route, landmarks) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const img = new ImageData(map.n, map.n);
  for (let i = 0; i < map.n * map.n; i++) {
    const k = map.kind[i];
    img.data.set(k === 2 ? [236, 235, 226, 255] : k === 3 ? [112, 114, 118, 255] : [58, 61, 56, 255], i * 4);
  }
  const tmp = document.createElement("canvas");
  tmp.width = tmp.height = map.n;
  tmp.getContext("2d").putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, W, W);
  const toPx = (x) => (x / map.size) * W;
  ctx.fillStyle = "#8b8c9c";
  for (const b of (map.scenery && map.scenery.buildings) || []) {
    if (b.k === "roof") continue;
    ctx.beginPath();
    b.p.forEach(([x, z], i) => (i ? ctx.lineTo(toPx(x), toPx(z)) : ctx.moveTo(toPx(x), toPx(z))));
    ctx.closePath();
    ctx.fill();
  }
  ctx.font = "bold 15px 'IBM Plex Sans KR', sans-serif";
  ctx.textBaseline = "middle";
  for (const l of landmarks) {
    const spec = SOUND_TYPES[l.type];
    const outside = l.x < 0 || l.z < 0 || l.x > map.size || l.z > map.size;
    const px = Math.max(14, Math.min(W - 14, toPx(l.x)));
    const pz = Math.max(14, Math.min(W - 14, toPx(l.z)));
    ctx.fillStyle = spec.color;
    ctx.beginPath(); ctx.arc(px, pz, 11, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
    const label = spec.label + (outside ? " (지도 밖)" : "");
    const tx = px > W - 140 ? px - 16 - ctx.measureText(label).width : px + 16;
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.strokeText(label, tx, pz);
    ctx.fillStyle = "#fff"; ctx.fillText(label, tx, pz);
  }
  const mark = (p, color, text) => {
    const x = toPx(p.x), z = toPx(p.z);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, z, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#000"; ctx.lineWidth = 2; ctx.stroke();
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.strokeText(text, x + 13, z);
    ctx.fillStyle = color; ctx.fillText(text, x + 13, z);
  };
  mark(route.startPos, "#3fbf6a", "출발");
  mark(route.goalPos, "#ffc94a", "목적지");
  ctx.fillStyle = "#fff";
  ctx.fillText("N ↑", W - 40, 18);
}

async function startRound() {
  // 행인·차량 모델을 아직 다 못 불러왔으면 잠깐(최대 8초) 기다린다. 실패하면 단순한 모양으로 진행한다
  if (!PEOPLE.ready() || !VEHICLES.ready() || !STREETPROPS.ready()) {
    setLoading(true, "사람과 차, 거리 소품을 불러오는 중입니다…");
    await Promise.race([Promise.all([PEOPLE.load().catch(() => {}), VEHICLES.load().catch(() => {}), STREETPROPS.load().catch(() => {})]), new Promise((r) => setTimeout(r, 8000))]);
    setLoading(false);
  }
  await Promise.race([SCENERY.load(), new Promise((r) => setTimeout(r, 3000))]);
  const withSound = state.order[state.round];
  $("play-label").textContent = `${state.round + 1}판 · ${withSound ? "소리 있음" : "소리 없음"}`;
  $("play-timer").textContent = `${Math.floor(CONFIG.ROUND_TIMEOUT_SEC / 60)}:00`;
  $("play-hud").hidden = !TEST_MODE;
  show("screen-play");
  runRound({
    canvas: $("game-canvas"),
    overlayEl: $("play-overlay"),
    timerEl: $("play-timer"),
    hudEl: $("play-hud"),
    map: state.map,
    route: state.routes[state.round],
    landmarks: state.landmarks,
    soundscape,
    withSound,
  }, (result) => {
    state.results.push(result);
    state.round++;
    if (state.round < 2) showBriefing();
    else showResult();
  });
}

// ---------- 결과 ----------
function fmtSec(s) {
  return `${Math.floor(s / 60)}분 ${String(Math.round(s % 60)).padStart(2, "0")}초`;
}

function showResult() {
  const silent = state.results.find((r) => !r.withSound);
  const sound = state.results.find((r) => r.withSound);
  // 포기한 판이 있으면 비교하지 않는다. 시간 초과는 논문처럼 잘린 값으로 비교하고 따로 표시한다.
  const gaveUp = state.results.some((r) => r.outcome === "gaveup");
  const ratio = !gaveUp && silent.elapsedSec > 0 && sound.elapsedSec > 0 ? sound.elapsedSec / silent.elapsedSec : null;

  const tbody = $("result-table").querySelector("tbody");
  tbody.textContent = "";
  state.results.forEach((r, i) => {
    const tr = document.createElement("tr");
    const status = r.outcome === "arrived" ? "" : r.outcome === "timeout" ? " (시간 초과)" : " (포기)";
    [`${i + 1}판`, r.withSound ? "있음" : "없음", fmtSec(r.elapsedSec) + status, `${r.distance}m / ${r.shortestMeters}m`]
      .forEach((t) => { const td = document.createElement("td"); td.textContent = t; tr.appendChild(td); });
    tbody.appendChild(tr);
  });

  let headline;
  if (gaveUp) headline = "포기한 판이 있어서 이번에는 비교하지 않았어요";
  else if (ratio === null) headline = "기록을 비교할 수 없습니다";
  else if (ratio < 0.95) headline = `소리가 있을 때 ${(1 / ratio).toFixed(1)}배 빨랐어요`;
  else if (ratio > 1.05) headline = `이번에는 소리가 없을 때 ${ratio.toFixed(1)}배 빨랐어요`;
  else headline = "소리가 있을 때와 없을 때가 거의 같았어요";
  $("result-headline").textContent = headline;

  const timedOut = state.results.some((r) => r.outcome === "timeout");
  $("result-note").textContent = gaveUp
    ? "두 판 모두 목적지에 도착하면 소리가 있을 때와 없을 때를 비교해 드립니다."
    : timedOut
    ? "제한시간 안에 도착하지 못한 판이 있어서, 그 판의 시간은 실제보다 짧게 잡혀 있습니다(논문의 제한시간 초과 표시와 같은 방식)."
    : `두 판의 최단 거리는 ${state.results[0].shortestMeters}m, ${state.results[1].shortestMeters}m로 거의 같게 맞췄습니다.`;

  drawChart($("result-chart"), ratio);
  show("screen-result");
}

function drawChart(container, myRatio) {
  const rows = PAPER.ratios3.map((p) => ({ label: `논문 ${p.id}`, value: p.ratio, me: false }));
  if (myRatio !== null) rows.push({ label: "나", value: myRatio, me: true });
  const maxV = Math.max(3, ...rows.map((r) => r.value));
  const W = 640, rowH = 30, left = 80, right = 60, top = 24;
  const H = top + rows.length * rowH + 10;
  const x = (v) => left + (v / maxV) * (W - left - right);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="시간비 비교">`;
  svg += `<line x1="${x(1)}" y1="10" x2="${x(1)}" y2="${H - 4}" stroke="currentColor" stroke-dasharray="4 4" opacity="0.6"/>`;
  svg += `<text x="${x(1) + 6}" y="16" font-size="12" fill="currentColor" opacity="0.8">1.0 = 소리 없을 때와 같음</text>`;
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const color = r.me ? "#d08a2e" : "#5980a6";
    svg += `<text x="${left - 10}" y="${y + 15}" font-size="13" text-anchor="end" fill="currentColor" font-weight="${r.me ? 700 : 400}">${r.label}</text>`;
    svg += `<rect x="${left}" y="${y + 4}" width="${Math.max(2, x(r.value) - left)}" height="${rowH - 10}" fill="${color}"/>`;
    svg += `<text x="${x(r.value) + 6}" y="${y + 15}" font-size="12" fill="currentColor">${r.value.toFixed(2)}</text>`;
  });
  svg += "</svg>";
  container.innerHTML = svg;
}

initHome();
