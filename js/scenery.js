// 지도 파일의 건물·도로·녹지·나무로 3D 거리 풍경을 만든다.
// 건물은 OSM 다각형을 실제 모양으로 세우고, 창문·간판·차선은 코드로 그린 텍스처로 붙인다.
// 좌표: x는 동쪽, z는 남쪽, 원점은 지도 북서쪽 모서리 (world.js와 같다)

const SCENERY = (() => {
  const FLOOR = 3.3, BAY = 3.2, SHOP_H = 4.2;
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

  // ---------- 코드로 그린 텍스처 (한 번만 만들고 판마다 다시 쓴다) ----------
  let TEX = null;
  function canvasTex(w, h, draw, aniso) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = aniso;
    return t;
  }
  function noise(g, w, h, amount, seed) {
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (hash(i * 0.37 + seed) - 0.5) * amount;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  }
  // ---------- 사진 텍스처 (Poly Haven CC0, assets/textures, tools/fetch_textures.mjs) ----------
  // 사진의 밝기 무늬만 쓴다: 평균 밝기를 1로 맞춘 비율을 바탕색에 곱하고, 색은 지금처럼 건물·길마다 꼭짓점 색으로 곱한다.
  // 못 불러오면 코드로 그린 무늬를 쓴다.
  const PHOTO_IDS = ["asphalt_02", "square_concrete_pavers", "red_brick_03", "white_plaster_02", "concrete_wall_003", "rectangular_facade_tiles", "concrete_tiles_02", "granite_tile_04"];
  const PHOTO = {};
  let photoLoad = null;
  function load() {
    if (!photoLoad) photoLoad = Promise.all(PHOTO_IDS.map((id) => new Promise((res) => {
      const img = new Image();
      img.onload = () => { PHOTO[id] = img; res(); };
      img.onerror = () => res();
      img.src = `assets/textures/${id}.jpg`;
    })));
    return photoLoad;
  }
  // (0,0,w,h)를 사진 n×n장으로 채운다. base: 바탕색 [r,g,b], contrast: 무늬 세기(1이면 사진 그대로의 명암)
  function photoFill(g, w, h, id, n, base, contrast) {
    const img = PHOTO[id];
    if (!img) return false;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x0 = Math.round((i * w) / n), y0 = Math.round((j * h) / n);
      g.drawImage(img, x0, y0, Math.round(((i + 1) * w) / n) - x0, Math.round(((j + 1) * h) / n) - y0);
    }
    const d = g.getImageData(0, 0, w, h), p = d.data;
    let sum = 0;
    for (let i = 0; i < p.length; i += 4) sum += p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11;
    const mean = sum / (p.length / 4) || 1;
    for (let i = 0; i < p.length; i += 4) {
      const k = 1 + ((p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11) / mean - 1) * contrast;
      p[i] = base[0] * k; p[i + 1] = base[1] * k; p[i + 2] = base[2] * k;
    }
    g.putImageData(d, 0, 0);
    return true;
  }
  // 간판 업종 이름 (상호 없이)
  const SHOP_WORDS = ["약국", "편의점", "분식", "미용실", "치킨", "부동산", "세탁소", "안경", "카페", "한식", "휴대폰", "마트", "정육점", "꽃집", "베이커리", "김밥", "노래방", "학원", "의원", "커피", "반찬", "철물점", "문구", "떡집"];
  const VERT_WORDS = ["학원", "치과", "내과", "한의원", "노래방", "PC방", "당구장", "헬스", "피아노", "수학", "영어", "필라테스", "모텔", "사우나", "태권도", "미술"];
  const SIGN_COLORS = ["#d8342c", "#1f5fbf", "#f2c230", "#2e8b57", "#f07f1f", "#f4f1ea", "#7a2f8f", "#14324f"];

  function textures(renderer) {
    if (TEX) return TEX;
    const a = renderer.capabilities.getMaxAnisotropy();
    TEX = {
      // 창문 벽: 가로 4칸(칸당 3.2m) × 세로 4층(층당 3.3m)
      punched: canvasTex(512, 512, (g, w, h) => {
        if (!photoFill(g, w, h, "white_plaster_02", 6, [250, 250, 250], 0.5)) { g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); noise(g, w, h, 10, 1); }
        for (let fy = 0; fy < 4; fy++) for (let fx = 0; fx < 4; fx++) {
          const x = fx * 128, y = fy * 128, r = hash(fx * 13 + fy * 7);
          g.fillStyle = "rgba(0,0,0,0.10)"; g.fillRect(x, y + 124, 128, 4);
          g.fillStyle = "#c9c4bb"; g.fillRect(x + 18, y + 28, 92, 72);
          const grd = g.createLinearGradient(0, y + 30, 0, y + 98);
          grd.addColorStop(0, r < 0.2 ? "#d8cdb4" : "#5a6d7e");
          grd.addColorStop(1, r < 0.2 ? "#b9ab8e" : "#2f3c48");
          g.fillStyle = grd; g.fillRect(x + 22, y + 32, 84, 64);
          g.fillStyle = "rgba(255,255,255,0.18)"; g.fillRect(x + 22, y + 32, 84, 10);
          g.fillStyle = "#c9c4bb"; g.fillRect(x + 62, y + 32, 4, 64);
          g.fillStyle = "rgba(0,0,0,0.22)"; g.fillRect(x + 16, y + 100, 96, 5);
        }
      }, a),
      // 띠창 벽: 층마다 가로로 길게 이어진 창
      ribbon: canvasTex(512, 512, (g, w, h) => {
        if (!photoFill(g, w, h, "rectangular_facade_tiles", 6, [248, 248, 248], 0.6)) { g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); noise(g, w, h, 8, 2); } // 타일 한 장 약 2m
        for (let fy = 0; fy < 4; fy++) {
          const y = fy * 128;
          const grd = g.createLinearGradient(0, y + 40, 0, y + 104);
          grd.addColorStop(0, "#6b8193"); grd.addColorStop(1, "#2c3946");
          g.fillStyle = grd; g.fillRect(0, y + 40, w, 64);
          g.fillStyle = "rgba(255,255,255,0.16)"; g.fillRect(0, y + 40, w, 9);
          g.fillStyle = "#d4d0c8";
          for (let x = 0; x < w; x += 64) g.fillRect(x, y + 40, 5, 64);
          g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(0, y + 104, w, 4);
        }
      }, a),
      glass: canvasTex(256, 256, (g, w, h) => {
        const grd = g.createLinearGradient(0, 0, w, h);
        grd.addColorStop(0, "#b9cfdc"); grd.addColorStop(0.5, "#86a3b6"); grd.addColorStop(1, "#a7bfcd");
        g.fillStyle = grd; g.fillRect(0, 0, w, h);
        g.fillStyle = "rgba(40,52,62,0.45)";
        for (let i = 0; i <= 4; i++) { g.fillRect(i * 64 - 2, 0, 4, h); g.fillRect(0, i * 64 - 2, w, 4); }
        for (let i = 0; i < 16; i++) if (hash(i * 5.1) < 0.3) { g.fillStyle = "rgba(255,255,255,0.12)"; g.fillRect((i % 4) * 64 + 2, Math.floor(i / 4) * 64 + 2, 60, 60); }
      }, a),
      // 1층 상가: 위쪽 간판 띠와 아래쪽 유리 진열창. 가로 8칸(칸당 4m), 높이 4.2m.
      // 간판에는 업종 이름만 쓴다(실제 상호는 쓰지 않는다, 2026-10-21 사용자 결정)
      shop: canvasTex(1024, 256, (g, w, h) => {
        g.fillStyle = "#3b3f44"; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 8; i++) {
          const x = i * 128, c = SIGN_COLORS[Math.floor(hash(i * 3.7 + 1) * SIGN_COLORS.length)];
          g.fillStyle = c; g.fillRect(x + 2, 8, 124, 58);
          g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(x + 2, 60, 124, 6);
          g.fillStyle = c === "#f4f1ea" || c === "#f2c230" ? "#1b1b1b" : "#fbfaf6";
          const word = SHOP_WORDS[Math.floor(hash(i * 9.1 + 2) * SHOP_WORDS.length)];
          g.font = `bold ${word.length > 3 ? 30 : 38}px 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif`;
          // 건물 벽은 바깥에서 볼 때 텍스처 가로 방향이 오른쪽에서 왼쪽이라 글자를 좌우로 뒤집어 그린다
          g.save(); g.translate(x + 64, 37); g.scale(-1, 1);
          g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(word, 0, 0, 116);
          g.restore();
          const grd = g.createLinearGradient(0, 80, 0, 250);
          grd.addColorStop(0, "#7e95a6"); grd.addColorStop(1, "#24313c");
          g.fillStyle = grd; g.fillRect(x + 8, 80, 112, 170);
          g.fillStyle = "rgba(255,240,210,0.35)"; g.fillRect(x + 14, 160, 100, 90);
          g.fillStyle = "#8f9398"; g.fillRect(x + 62, 80, 4, 170);
        }
      }, a),
      // 빌라(다세대 주택): 벽돌 벽에 층마다 넓은 창(확장 발코니)과 낮은 난간, 창 아래 실외기, 층 사이 콘크리트 띠.
      // 가로 4칸(칸당 3.2m) × 세로 4층. 벽 색은 건물마다 꼭짓점 색(VILLA_TINTS)으로 곱한다
      villa: canvasTex(512, 512, (g, w, h) => {
        if (!photoFill(g, w, h, "red_brick_03", 13, [236, 230, 224], 0.7)) { g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); noise(g, w, h, 14, 13); }
        for (let fy = 0; fy < 4; fy++) {
          const y = fy * 128;
          g.fillStyle = "#e4e0d8"; g.fillRect(0, y + 116, w, 12); // 층 사이 콘크리트 띠
          for (let fx = 0; fx < 4; fx++) {
            const x = fx * 128, wide = hash(fx * 5 + fy * 3 + 1) < 0.65;
            if (wide) {
              g.fillStyle = "#cfd2d4"; g.fillRect(x + 8, y + 22, 112, 82); // 알루미늄 창틀
              const grd = g.createLinearGradient(0, y + 26, 0, y + 100);
              grd.addColorStop(0, "#6f8494"); grd.addColorStop(1, "#2f3a44");
              g.fillStyle = grd; g.fillRect(x + 12, y + 26, 104, 74);
              g.fillStyle = "#cfd2d4"; g.fillRect(x + 42, y + 26, 3, 74); g.fillRect(x + 83, y + 26, 3, 74);
              if (hash(fx * 11 + fy * 7) < 0.3) { g.fillStyle = "rgba(238,232,220,0.85)"; g.fillRect(x + 46, y + 30, 36, 66); } // 커튼
              g.fillStyle = "#3f4447"; g.fillRect(x + 8, y + 74, 112, 3); // 난간 손잡이
              for (let k = 0; k < 12; k++) g.fillRect(x + 12 + k * 9, y + 77, 2, 27);
            } else {
              g.fillStyle = "#d8d6d0"; g.fillRect(x + 34, y + 34, 60, 52);
              g.fillStyle = "#3a4650"; g.fillRect(x + 38, y + 38, 52, 44);
              g.fillStyle = "rgba(50,50,50,0.9)"; for (let k = 0; k < 5; k++) g.fillRect(x + 42 + k * 10, y + 38, 2, 44); // 방범창
            }
            if (hash(fx * 13 + fy * 17 + 5) < 0.35) { // 창 아래 실외기
              g.fillStyle = "#e9e9e4"; g.fillRect(x + 76, y + 104, 34, 14);
              g.fillStyle = "#9a9d9f"; g.beginPath(); g.arc(x + 88, y + 111, 5, 0, Math.PI * 2); g.fill();
            }
          }
        }
      }, a),
      // 필로티 주차장: 1층을 비우고 기둥만 세운 빌라 아래 (어두운 안쪽, 칸당 3.2m에 기둥 하나, 천장 띠)
      piloti: canvasTex(256, 128, (g, w, h) => {
        const grd = g.createLinearGradient(0, 0, 0, h);
        grd.addColorStop(0, "#1f2225"); grd.addColorStop(1, "#3a3d40");
        g.fillStyle = grd; g.fillRect(0, 0, w, h);
        g.fillStyle = "#cfcbc3"; g.fillRect(0, 0, w, 14); // 천장 보
        for (let x = 0; x < w; x += 64) { g.fillStyle = "#c4c0b8"; g.fillRect(x, 0, 12, h); g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(x + 12, 14, 4, h - 14); }
        g.fillStyle = "#f2c230"; for (let x = 0; x < w; x += 64) g.fillRect(x, h - 22, 12, 6); // 기둥 아래 노란 보호대
      }, a),
      // 붉은 벽돌 벽 (80~90년대 다세대 주택): 창문 배치는 punched와 같다 (가로 4칸 × 세로 4층)
      brick: canvasTex(512, 512, (g, w, h) => {
        if (!photoFill(g, w, h, "red_brick_03", 13, [232, 222, 214], 0.8)) { // 사진 한 장 1m
          g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
          for (let r = 0; r < 64; r++) for (let c = 0; c < 17; c++) {
            const v = hash(r * 41 + c * 13) * 30 - 15;
            g.fillStyle = `rgb(${226 + v},${214 + v},${206 + v})`;
            g.fillRect(c * 32 - (r % 2 ? 16 : 0) + 1, r * 8 + 1, 30, 6);
          }
        }
        for (let fy = 0; fy < 4; fy++) for (let fx = 0; fx < 4; fx++) {
          const x = fx * 128, y = fy * 128;
          g.fillStyle = "#dcd8d0"; g.fillRect(x + 20, y + 30, 88, 70);
          const grd = g.createLinearGradient(0, y + 34, 0, y + 96);
          grd.addColorStop(0, "#5d6f7c"); grd.addColorStop(1, "#2c3740");
          g.fillStyle = grd; g.fillRect(x + 24, y + 34, 80, 62);
          g.fillStyle = "#dcd8d0"; g.fillRect(x + 62, y + 34, 4, 62);
          g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(x + 18, y + 100, 92, 6); // 창턱
          if (hash(fx * 3 + fy * 11) < 0.5) { g.fillStyle = "rgba(60,60,60,0.9)"; for (let k = 0; k < 6; k++) g.fillRect(x + 26 + k * 14, y + 34, 3, 62); } // 방범창
        }
      }, a),
      // 회색 블록 벽: 작은 창
      block: canvasTex(512, 512, (g, w, h) => {
        if (!photoFill(g, w, h, "concrete_wall_003", 4, [226, 226, 222], 0.7)) { // 사진 한 장 약 3m
          g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
          for (let r = 0; r < 32; r++) for (let c = 0; c < 9; c++) {
            const v = hash(r * 23 + c * 7) * 18 - 9;
            g.fillStyle = `rgb(${222 + v},${222 + v},${218 + v})`;
            g.fillRect(c * 64 - (r % 2 ? 32 : 0) + 1, r * 16 + 1, 62, 14);
          }
        }
        for (let fy = 0; fy < 4; fy++) for (let fx = 0; fx < 4; fx++) {
          if (hash(fx * 7 + fy * 5) < 0.35) continue;
          const x = fx * 128, y = fy * 128;
          g.fillStyle = "#3a434a"; g.fillRect(x + 34, y + 40, 60, 46);
          g.fillStyle = "#cfcfcf"; g.fillRect(x + 62, y + 40, 4, 46);
        }
      }, a),
      // 공장·창고의 골함석 패널: 세로 골, 위쪽에 띠창 하나
      metal: canvasTex(256, 256, (g, w, h) => {
        g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
        for (let x = 0; x < w; x += 8) { g.fillStyle = "rgba(0,0,0,0.10)"; g.fillRect(x, 0, 3, h); g.fillStyle = "rgba(255,255,255,0.4)"; g.fillRect(x + 4, 0, 2, h); }
        g.fillStyle = "#56656f"; g.fillRect(0, 20, w, 26);
        g.fillStyle = "rgba(0,0,0,0.2)"; g.fillRect(0, h - 10, w, 10);
      }, a),
      // 아파트: 층마다 발코니 난간 띠와 큰 창 (가로 4칸 × 세로 4층)
      apt: canvasTex(512, 512, (g, w, h) => {
        if (!photoFill(g, w, h, "white_plaster_02", 6, [250, 250, 250], 0.35)) { g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); noise(g, w, h, 6, 11); }
        for (let fy = 0; fy < 4; fy++) {
          const y = fy * 128;
          const grd = g.createLinearGradient(0, y + 22, 0, y + 92);
          grd.addColorStop(0, "#71879a"); grd.addColorStop(1, "#33414d");
          for (let fx = 0; fx < 4; fx++) { g.fillStyle = grd; g.fillRect(fx * 128 + 10, y + 22, 108, 70); }
          for (let fx = 0; fx < 4; fx++) if (hash(fx * 5 + fy * 3) < 0.25) { g.fillStyle = "rgba(240,236,226,0.85)"; g.fillRect(fx * 128 + 14, y + 26, 46, 62); } // 커튼
          g.fillStyle = "#e9e6df"; g.fillRect(0, y + 92, w, 30); // 발코니 난간 벽
          g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(0, y + 92, w, 3);
          g.fillStyle = "#9aa4ab"; for (let x = 0; x < w; x += 128) g.fillRect(x, y + 18, 6, 104);
        }
      }, a),
      // 기와: 짙은 회색 기왓골 줄 (가로 1m당 2골)
      tile: canvasTex(256, 256, (g, w, h) => {
        g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
        for (let x = 0; x < w; x += 32) {
          const grd = g.createLinearGradient(x, 0, x + 32, 0);
          grd.addColorStop(0, "#9a9a9a"); grd.addColorStop(0.5, "#ffffff"); grd.addColorStop(1, "#8a8a8a");
          g.fillStyle = grd; g.fillRect(x, 0, 32, h);
        }
        for (let y = 0; y < h; y += 32) { g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(0, y, w, 3); }
        noise(g, w, h, 16, 12);
      }, a),
      roof: canvasTex(256, 256, (g, w, h) => {
        if (!photoFill(g, w, h, "concrete_wall_003", 1, [245, 245, 245], 0.6)) { g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); noise(g, w, h, 26, 3); }
        g.fillStyle = "rgba(0,0,0,0.08)"; for (let i = 0; i < 8; i++) g.fillRect(i * 32, 0, 2, h);
      }, a),
      // 보도블록: 한국 보도에 흔한 회색 직사각 블록을 엇갈려 깐 모습(2026-10-21, 예전에는 정사각 콘크리트 판).
      // 바닥 텍스처 한 장이 4m라 사진(1.8m)을 2×2장 넣는다
      paving: PHOTO.concrete_tiles_02 ? canvasTex(512, 512, (g, w, h) => photoFill(g, w, h, "concrete_tiles_02", 2, [178, 176, 171], 0.9), a) : canvasTex(256, 256, (g, w, h) => {
        g.fillStyle = "#a99f92"; g.fillRect(0, 0, w, h);
        for (let r = 0; r < 20; r++) for (let c = 0; c < 10; c++) {
          const v = hash(r * 31 + c * 7) * 14 - 7;
          g.fillStyle = `rgb(${170 + v},${160 + v},${148 + v})`;
          g.fillRect(c * 25.6 + (r % 2 ? 12.8 : 0), r * 12.8, 24.6, 11.8);
        }
        noise(g, w, h, 10, 4);
      }, a),
      // 광장: 큰 화강석 판 (사진 2m를 2×2장, 한 장 4m)
      plaza: PHOTO.granite_tile_04 ? canvasTex(512, 512, (g, w, h) => photoFill(g, w, h, "granite_tile_04", 2, [196, 192, 185], 0.8), a) : canvasTex(256, 256, (g, w, h) => {
        g.fillStyle = "#cfc8bd"; g.fillRect(0, 0, w, h);
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
          const v = hash(r * 17 + c * 3) * 16 - 8;
          g.fillStyle = `rgb(${205 + v},${198 + v},${187 + v})`; g.fillRect(c * 32 + 1, r * 32 + 1, 30, 30);
        }
        noise(g, w, h, 8, 5);
      }, a),
      // 아스팔트: 차도 텍스처 한 장이 6m라 사진(3m)을 2×2장 넣는다
      asphalt: canvasTex(512, 512, (g, w, h) => { if (!photoFill(g, w, h, "asphalt_02", 2, [69, 72, 76], 0.9)) { g.fillStyle = "#45484c"; g.fillRect(0, 0, w, h); noise(g, w, h, 22, 6); } }, a),
      grass: canvasTex(256, 256, (g, w, h) => { g.fillStyle = "#6f8d4c"; g.fillRect(0, 0, w, h); noise(g, w, h, 34, 7); }, a),
      hedge: canvasTex(128, 128, (g, w, h) => {
        g.fillStyle = "#4f7038"; g.fillRect(0, 0, w, h); noise(g, w, h, 60, 8);
        g.fillStyle = "#8d8577"; g.fillRect(0, h - 26, w, 26); // 화단 아래 돌 테두리
      }, a),
      // 공사 가림막: 판넬 4장(장당 2m × 2.4m). 흰 판에 파란 띠, 한국 공사장에서 흔한 문구를 적는다
      panel: canvasTex(1024, 512, (g, w, h) => {
        const words = ["공사중", "안전제일", "통행제한", "우회하세요"];
        for (let i = 0; i < 4; i++) {
          const x = i * 256;
          g.fillStyle = "#f3f4f1"; g.fillRect(x, 0, 256, h);
          g.fillStyle = "#1f4fa0"; g.fillRect(x, 18, 256, 22); g.fillRect(x, h - 120, 256, 120);
          g.fillStyle = "#2e8b57"; g.fillRect(x, h - 132, 256, 10);
          g.fillStyle = "#1f4fa0";
          g.font = "bold 50px 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
          g.textAlign = "center"; g.textBaseline = "middle";
          g.fillText(words[i], x + 128, h * 0.42);
          g.fillStyle = "#ffffff"; g.font = "bold 26px 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
          g.fillText("SAFETY FIRST", x + 128, h - 60);
          g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(x + 252, 0, 4, h); // 판넬 이음매
        }
        noise(g, w, h, 6, 9);
      }, a),
      // 노란색·검은색 사선 줄무늬 (1m에 한 쌍)
      stripes: canvasTex(128, 32, (g, w, h) => {
        g.fillStyle = "#f2c230"; g.fillRect(0, 0, w, h);
        g.fillStyle = "#1d1d1d";
        for (let x = -h; x < w + h; x += 64) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 32, h); g.lineTo(x + 32 + h, 0); g.lineTo(x + h, 0); g.fill(); }
      }, a),
      // 보행자 방호 울타리: 2m × 1.2m. 한국 큰길 보도의 흰 세로살 울타리 (살 사이 약 11cm). 살 사이만 투명하게 둔다
      // 살이 가늘면 멀리서 안 보여서 길을 막는지 알기 어려웠다 (2026-10-20 사용자 확인). 살을 굵고 촘촘하게, 가장자리를 어둡게 그린다
      fence: (() => {
        const t = canvasTex(256, 128, (g, w, h) => {
          g.clearRect(0, 0, w, h);
          const bar = (x, y, bw, bh) => { g.fillStyle = "#6d7378"; g.fillRect(x - 1, y - 1, bw + 2, bh + 2); g.fillStyle = "#eef0f1"; g.fillRect(x, y, bw, bh); };
          for (let x = 8; x < w - 8; x += 14) bar(x, 16, 6, 96); // 세로살
          bar(0, 4, w, 14); bar(0, 104, w, 12); // 위·아래 가로대
          bar(0, 0, 8, h); bar(w - 8, 0, 8, h); // 기둥
          g.fillStyle = "#e8b828"; g.fillRect(0, 7, w, 4); // 위 가로대의 노란 반사띠
        }, a);
        return t;
      })(),
      // 화강석 연석: 사진 한 장(2m)을 띠 길이 방향으로 쓴다
      curb: canvasTex(256, 256, (g, w, h) => { if (!photoFill(g, w, h, "granite_tile_04", 1, [186, 184, 180], 0.7)) { g.fillStyle = "#bab8b4"; g.fillRect(0, 0, w, h); noise(g, w, h, 18, 11); } }, a),
      // 노란 점자블록: 한 장 0.3m. 선형(걷는 방향으로 긴 돌기 4줄)과 점형(5×5 돌기)
      tactLine: canvasTex(64, 64, (g, w, h) => {
        g.fillStyle = "#d9ae17"; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 4; i++) { const x = 5 + i * 15; g.fillStyle = "#b8900f"; g.fillRect(x + 6, 4, 2, h - 8); g.fillStyle = "#f2cb2c"; g.fillRect(x, 4, 6, h - 8); }
        g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(0, 0, w, 1); g.fillRect(0, 0, 1, h);
        noise(g, w, h, 14, 21);
      }, a),
      tactDot: canvasTex(64, 64, (g, w, h) => {
        g.fillStyle = "#d9ae17"; g.fillRect(0, 0, w, h);
        for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
          const x = 7 + c * 12.5, y = 7 + r * 12.5;
          g.fillStyle = "#b8900f"; g.beginPath(); g.arc(x + 1, y + 1, 4, 0, Math.PI * 2); g.fill();
          g.fillStyle = "#f4d03a"; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
        }
        g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(0, 0, w, 1); g.fillRect(0, 0, 1, h);
        noise(g, w, h, 14, 23);
      }, a),
      // 보행자 우선도로 색 포장: 0.5m 네모를 색을 바꿔 가며 깐다 (한 장 2m)
      stamp: canvasTex(256, 256, (g, w, h) => {
        const cols = ["#b06a52", "#c9a882", "#9a948c", "#d6c7a8", "#a55a44", "#bdb2a2"];
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { g.fillStyle = cols[Math.floor(hash(r * 7 + c * 13 + 3) * cols.length)]; g.fillRect(c * 64, r * 64, 64, 64); }
        g.fillStyle = "rgba(60,55,50,0.55)"; for (let i = 0; i <= 4; i++) { g.fillRect(i * 64 - 1, 0, 2, h); g.fillRect(0, i * 64 - 1, w, 2); }
        noise(g, w, h, 18, 25);
      }, a),
      // 가로수 보호판: 1.2m 철판, 가운데 둥근 흙 구멍과 바퀴살 모양 틈
      grate: canvasTex(128, 128, (g, w, h) => {
        g.fillStyle = "#6a6e72"; g.fillRect(0, 0, w, h);
        g.strokeStyle = "#383b3e"; g.lineWidth = 3;
        for (let k = 0; k < 24; k++) { const t = (k / 24) * Math.PI * 2; g.beginPath(); g.moveTo(64 + Math.cos(t) * 26, 64 + Math.sin(t) * 26); g.lineTo(64 + Math.cos(t) * 58, 64 + Math.sin(t) * 58); g.stroke(); }
        g.strokeStyle = "#8a8e92"; g.lineWidth = 3; g.strokeRect(2, 2, w - 4, h - 4);
        g.fillStyle = "#3b2f25"; g.beginPath(); g.arc(64, 64, 22, 0, Math.PI * 2); g.fill();
        noise(g, w, h, 12, 27);
      }, a),
      // 라바콘: 주황 몸통에 흰 반사띠 두 줄 (위가 캔버스 위쪽)
      cone: canvasTex(16, 128, (g, w, h) => {
        g.fillStyle = "#f2611d"; g.fillRect(0, 0, w, h);
        g.fillStyle = "#f4f4f0"; g.fillRect(0, h * 0.28, w, h * 0.13); g.fillRect(0, h * 0.55, w, h * 0.11);
      }, a),
    };
    TEX.ground = TEX.paving.clone();
    TEX.ground.needsUpdate = true;
    return TEX;
  }

  // ---------- 기하 버퍼 ----------
  const buf = () => ({ p: [], n: [], u: [], c: [] });
  function vtx(B, x, y, z, nx, ny, nz, u, v, col) { B.p.push(x, y, z); B.n.push(nx, ny, nz); B.u.push(u, v); B.c.push(col.r, col.g, col.b); }
  function toMesh(B, mat, cast) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(B.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(B.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(B.u, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(B.c, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = !!cast; m.receiveShadow = true;
    return m;
  }
  // 위를 향하는 평면 삼각형. 감기는 방향이 거꾸로면 바로잡는다.
  function triUp(B, a, b, c, y, s, col) {
    const cross = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    if (cross < 0) { const t = b; b = c; c = t; }
    for (const q of [a, b, c]) vtx(B, q[0], y, q[1], 0, 1, 0, q[0] / s, -q[1] / s, col);
  }
  // 위를 향한 네모 (q: [[x, z, u, v] × 4]). 삼각형마다 위에서 볼 때 앞면이 되게 순서를 맞춘다 (DoubleSide 재질도 뒷면이면 빛을 거꾸로 받는다)
  function upQuad(B, q, y, col) {
    for (const [i, j, k] of [[0, 1, 2], [0, 2, 3]]) {
      let a = q[i], b = q[j], c = q[k];
      if ((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) < 0) { const t = b; b = c; c = t; }
      for (const p of [a, b, c]) vtx(B, p[0], y, p[1], 0, 1, 0, p[2], p[3], col);
    }
  }
  function quadUp(B, a, b, c, d, y, s, col) { triUp(B, a, b, c, y, s, col); triUp(B, a, c, d, y, s, col); }
  function polyUp(B, pts, y, s, col) {
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), []); } catch (e) { return; }
    for (const t of tris) triUp(B, pts[t[0]], pts[t[1]], pts[t[2]], y, s, col);
  }
  function pointInPoly(x, z, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }
  // 바깥을 향하는 법선이 (dz, -dx)가 되도록 꼭짓점 순서를 맞춘다
  function orient(raw) {
    const pts = raw.slice();
    let s = 0;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; }
    if (s < 0) pts.reverse();
    return { pts, area: Math.abs(s) / 2 };
  }
  // 벽: 칸 수와 층 수를 정수로 맞춰서 창문이 모서리에서 잘리지 않게 한다
  // skip: 그리지 않을 벽 번호 (Set, 따로 그리는 아파트 옆벽)
  function addWalls(B, pts, y0, y1, col, bayW, perTileU, floorH, perTileV, seed, ao, skip) {
    const nf = Math.max(1, Math.round((y1 - y0) / floorH));
    const cBottom = col.clone().multiplyScalar(ao);
    for (let i = 0; i < pts.length; i++) {
      if (skip && skip.has(i)) continue;
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      const nx = dz / len, nz = -dx / len;
      const u0 = Math.floor(hash(seed + i * 3.3) * 4) / 4, u1 = u0 + Math.max(1, Math.round(len / bayW)) / perTileU;
      const v1 = nf / perTileV;
      const put = (x, y, z, u, v, c) => vtx(B, x, y, z, nx, 0, nz, u, v, c);
      put(a[0], y0, a[1], u0, 0, cBottom); put(b[0], y1, b[1], u1, v1, col); put(b[0], y0, b[1], u1, 0, cBottom);
      put(a[0], y0, a[1], u0, 0, cBottom); put(a[0], y1, a[1], u0, v1, col); put(b[0], y1, b[1], u1, v1, col);
    }
  }

  // 우진각 지붕(기와집): 바닥 모양을 감싸는 가장 작은 직사각형 위에 얹는다.
  // 바닥이 직사각형에서 많이 벗어나면(넓이 비율 0.7 미만) false를 돌려주고, 부르는 쪽이 평지붕을 쓴다.
  function hipRoof(B, pts, y, col) {
    let best = null;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.5) continue;
      const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const p of pts) { const u = p[0] * ux + p[1] * uz, v = -p[0] * uz + p[1] * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      const ar = (u1 - u0) * (v1 - v0);
      if (!best || ar < best.ar) best = { ar, ux, uz, u0, u1, v0, v1 };
    }
    if (!best) return false;
    const { area } = orient(pts);
    if (area / best.ar < 0.7) return false;
    let { ux, uz, u0, u1, v0, v1 } = best;
    if (u1 - u0 < v1 - v0) { [ux, uz] = [-uz, ux]; [u0, u1, v0, v1] = [v0, v1, -u1, -u0]; } // 용마루가 긴 쪽을 따르게
    const O = 0.45; // 처마
    u0 -= O; u1 += O; v0 -= O; v1 += O;
    const L = u1 - u0, W = v1 - v0, rise = Math.min(4, W * 0.32), vm = (v0 + v1) / 2;
    const P = (u, v) => [u * ux - v * uz, u * uz + v * ux];
    const e = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
    const r0 = P(u0 + W / 2, vm), r1 = P(u1 - W / 2, vm);
    const tri = (p, q, s) => {
      const A = [p[0], p[2], p[1]], Bv = [q[0], q[2], q[1]], C = [s[0], s[2], s[1]];
      const e1 = [Bv[0] - A[0], Bv[1] - A[1], Bv[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (n[1] < 0) { n = n.map((x) => -x); [q, s] = [s, q]; }
      const nl = Math.hypot(...n) || 1;
      for (const t of [p, q, s]) vtx(B, t[0], t[2], t[1], n[0] / nl, n[1] / nl, n[2] / nl, t[0] * 0.5, t[1] * 0.5 + t[2], col);
    };
    const Y = (p, h) => [p[0], p[1], h];
    const top0 = Y(r0, y + rise), top1 = Y(r1, y + rise);
    tri(Y(e[0], y), Y(e[1], y), top1); tri(Y(e[0], y), top1, top0); // 긴 쪽 두 면
    tri(Y(e[2], y), Y(e[3], y), top0); tri(Y(e[2], y), top0, top1);
    tri(Y(e[3], y), Y(e[0], y), top0); tri(Y(e[1], y), Y(e[2], y), top1); // 짧은 쪽 두 면
    return true;
  }

  // 글자판 한 장: 벽 a→b 바깥쪽에 붙인다. 밖에서 보면 b가 왼쪽이므로 u0를 b에 둔다
  function labelQuad(B, a, b, y0, y1, uv, col) {
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
    const nx = dz / len, nz = -dx / len, off = 0.06;
    const A = [a[0] + nx * off, a[1] + nz * off], Bq = [b[0] + nx * off, b[1] + nz * off];
    const put = (p, y, u, v) => vtx(B, p[0], y, p[1], nx, 0, nz, u, v, col);
    put(A, y0, uv.u1, uv.v0); put(Bq, y1, uv.u0, uv.v1); put(Bq, y0, uv.u0, uv.v0);
    put(A, y0, uv.u1, uv.v0); put(A, y1, uv.u1, uv.v1); put(Bq, y1, uv.u0, uv.v1);
  }

  // 세로로 선 사각형 한 장 (a에서 b까지, 높이 y0~y1)
  function vquad(B, a, b, y0, y1, u0, u1, col) {
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
    const nx = dz / len, nz = -dx / len;
    const put = (x, y, z, u, v) => vtx(B, x, y, z, nx, 0, nz, u, v, col);
    put(a[0], y0, a[1], u0, 0); put(b[0], y1, b[1], u1, 1); put(b[0], y0, b[1], u1, 0);
    put(a[0], y0, a[1], u0, 0); put(a[0], y1, a[1], u0, 1); put(b[0], y1, b[1], u1, 1);
  }

  // 지하도 입구 (js/world.js placeUnderpass): 낮은 화강석 벽 세 면, 계단 바닥(그림), 기둥 넷과 유리 지붕, 출구 번호판.
  // 바닥은 충돌 판정에 넣는다 (들어가는 쪽으로 밀고 들어가면 js/game.js가 출구 고르기를 띄운다)
  function drawUnderpass(group, up, solids, aniso) {
    const list = up.exits;
    if (!list.length) return;
    const lin = (h) => new THREE.Color(h).convertSRGBToLinear();
    const WALL = buf(), POST = buf(), ROOF = buf(), PIT = buf(), SIGN = buf();
    const stone = lin("#bdb8ae"), dark = lin("#3f4448"), glass = lin("#9fbfcc"), WHITE1 = new THREE.Color(1, 1, 1);
    const box = (B, cx, cz, tx, tz, hl, hw, y0, y1, col) => {
      const nx = -tz, nz = tx, P = (a, b) => [cx + tx * a + nx * b, cz + tz * a + nz * b];
      const { pts } = orient([P(-hl, -hw), P(hl, -hw), P(hl, hw), P(-hl, hw)]);
      addWalls(B, pts, y0, y1, col, 1, 1, y1 - y0, 1, 0, 0.92);
      polyUp(B, pts, y1, 2, col);
    };
    // 계단 그림: 위(들어가는 쪽)가 밝고 아래(땅속)로 갈수록 어둡다
    const pitTex = canvasTex(128, 256, (g, w, h) => {
      for (let i = 0; i < 16; i++) {
        const y = (i * h) / 16, k = 1 - i / 18;
        g.fillStyle = `rgb(${Math.round(150 * k)},${Math.round(148 * k)},${Math.round(142 * k)})`; g.fillRect(0, y, w, h / 16);
        g.fillStyle = `rgb(${Math.round(70 * k)},${Math.round(68 * k)},${Math.round(64 * k)})`; g.fillRect(0, y + h / 16 - 4, w, 4);
      }
      g.fillStyle = "#c9a227"; g.fillRect(6, 0, 4, h); g.fillRect(w - 10, 0, 4, h); // 양옆 손잡이
    }, aniso);
    // 번호판: 한 장에 출구마다 한 칸
    const signTex = canvasTex(512, 96 * list.length, (g, w) => {
      list.forEach((e, k) => {
        const y = k * 96;
        g.fillStyle = "#1f3f73"; g.fillRect(0, y, w, 96);
        g.fillStyle = "#ffffff"; g.fillRect(14, y + 18, 60, 60);
        g.fillStyle = "#1f3f73"; g.font = "bold 46px 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
        g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(e.no, 44, y + 50);
        g.fillStyle = "#ffffff"; g.font = "bold 40px 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
        g.textAlign = "left"; g.fillText(`${up.station} · 지하도`, 92, y + 50);
      });
    }, aniso);
    signTex.wrapS = signTex.wrapT = THREE.ClampToEdgeWrapping;
    list.forEach((e, k) => {
      const { x, z, tx, tz } = e, nx = -tz, nz = tx, hl = e.L / 2, hw = e.W / 2, t = 0.2;
      const P = (a, b) => [x + tx * a + nx * b, z + tz * a + nz * b];
      for (const s of [-1, 1]) box(WALL, x + nx * s * (hw - t / 2), z + nz * s * (hw - t / 2), tx, tz, hl, t / 2, 0, 1.05, stone);
      box(WALL, x - tx * (hl - t / 2), z - tz * (hl - t / 2), tx, tz, t / 2, hw, 0, 1.05, stone);
      for (const a of [-hl + 0.15, hl - 0.15]) for (const s of [-1, 1]) box(POST, x + tx * a + nx * s * (hw - 0.1), z + tz * a + nz * s * (hw - 0.1), tx, tz, 0.06, 0.06, 1.05, 2.6, dark);
      box(ROOF, x, z, tx, tz, hl + 0.3, hw + 0.2, 2.6, 2.7, glass);
      // 계단 바닥 (v = 1이 들어가는 쪽)
      const q = [P(-hl + t, -hw + t), P(hl, -hw + t), P(hl, hw - t), P(-hl + t, hw - t)], uv = [[0, 0], [0, 1], [1, 1], [1, 0]];
      for (const i of [0, 1, 2, 0, 2, 3]) vtx(PIT, q[i][0], 0.05, q[i][1], 0, 1, 0, uv[i][0], uv[i][1], WHITE1);
      // 번호판: 지붕 앞 끝 위. 밖에서 볼 때 왼쪽에서 오른쪽으로 읽힌다 (보는 사람의 오른쪽은 -n 방향)
      const A = P(hl + 0.32, hw), B = P(hl + 0.32, -hw), v0 = 1 - (k + 1) / list.length, v1 = 1 - k / list.length;
      const S = [[A, 2.72, 0, v0], [B, 2.72, 1, v0], [B, 3.2, 1, v1], [A, 3.2, 0, v1]];
      for (const i of [0, 1, 2, 0, 2, 3]) { const [p, y, u, v] = S[i]; vtx(SIGN, p[0], y, p[1], tx, 0, tz, u, v, WHITE1); }
      const xs = e.pts.map((p) => p[0]), zs = e.pts.map((p) => p[1]);
      const poly = { pts: orient(e.pts).pts, minx: Math.min(...xs), maxx: Math.max(...xs), minz: Math.min(...zs), maxz: Math.max(...zs), underpass: k };
      solids.add(poly.minx, poly.minz, poly.maxx, poly.maxz, poly);
    });
    const plain = (extra) => new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.85, metalness: 0 }, extra));
    group.add(toMesh(WALL, plain({}), true), toMesh(POST, plain({ roughness: 0.5, metalness: 0.4 }), true));
    const roof = toMesh(ROOF, plain({ transparent: true, opacity: 0.55, roughness: 0.15, side: THREE.DoubleSide, depthWrite: false }), false);
    group.add(roof);
    group.add(toMesh(PIT, new THREE.MeshBasicMaterial({ map: pitTex, side: THREE.DoubleSide }), false));
    group.add(toMesh(SIGN, new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide }), false));
  }

  // 칸 가운데 점에서 inside(r, c)인 칸 덩어리의 경계 고리들 (marching squares). 대각선으로만 닿은 칸도 이어 본다
  function traceLoops(inside, n, cell) {
    const P = (r, c) => [(c + 0.5) * cell, (r + 0.5) * cell];
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const next = new Map(), key = (p) => p[0].toFixed(2) + "," + p[1].toFixed(2);
    const seg = (a, b) => next.set(key(a), { a, b });
    for (let r = -1; r < n; r++) for (let c = -1; c < n; c++) {
      // 네 점: 0 (r,c) 1 (r,c+1) 2 (r+1,c+1) 3 (r+1,c)
      const v = [inside(r, c), inside(r, c + 1), inside(r + 1, c + 1), inside(r + 1, c)];
      const k = (v[0] ? 1 : 0) | (v[1] ? 2 : 0) | (v[2] ? 4 : 0) | (v[3] ? 8 : 0);
      if (k === 0 || k === 15) continue;
      const p = [P(r, c), P(r, c + 1), P(r + 1, c + 1), P(r + 1, c)];
      const e = [mid(p[0], p[1]), mid(p[1], p[2]), mid(p[2], p[3]), mid(p[3], p[0])]; // 위, 오른쪽, 아래, 왼쪽 변
      // 안쪽을 왼쪽에 두는 방향으로 선분을 만든다 (변 번호 쌍)
      const T = { 1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 2], [1, 0]], 6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]],
        9: [[2, 0]], 10: [[0, 3], [2, 1]], 11: [[2, 1]], 12: [[1, 3]], 13: [[1, 0]], 14: [[0, 3]] }[k];
      for (const [i, j] of T) seg(e[i], e[j]);
    }
    const loops = [];
    for (const start of [...next.keys()]) {
      if (!next.has(start)) continue;
      const loop = [];
      let k = start;
      while (next.has(k)) { const s = next.get(k); next.delete(k); loop.push(s.a); k = key(s.b); }
      if (loop.length >= 3) loops.push(loop);
    }
    return loops;
  }
  // 닫힌 고리를 Douglas-Peucker로 줄인다 (tol: 허용 오차 m)
  function simplifyLoop(loop, tol) {
    if (loop.length < 8) return loop;
    const dp = (pts) => {
      const a = pts[0], b = pts[pts.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
      let far = -1, fd = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / L;
        if (d > fd) { fd = d; far = i; }
      }
      if (fd <= tol) return [a, b];
      const l = dp(pts.slice(0, far + 1)), r = dp(pts.slice(far));
      return l.slice(0, -1).concat(r);
    };
    // 첫 점에서 가장 먼 점으로 둘로 나눠 줄인다
    let far = 0, fd = 0;
    for (let i = 1; i < loop.length; i++) { const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]); if (d > fd) { fd = d; far = i; } }
    const A = dp(loop.slice(0, far + 1)), B = dp(loop.slice(far).concat([loop[0]]));
    return A.slice(0, -1).concat(B.slice(0, -1));
  }

  const MARGIN = 350; // 지도 밖으로 배경을 그리는 거리(m). tools/build_maps.mjs의 SCENERY_MARGIN과 같다
  const EDGE_BAND = 1.8; // 지도 가장자리에서 이 거리 안으로는 들어가지 못한다 (가림막과 라바콘이 서는 자리)

  const WALL_TINTS =["#ebe6dc", "#e0d9cb", "#d3cdc3", "#e8e3d8", "#cbc1b2", "#bcb1a2", "#dcd6ce", "#aca69d", "#c9d2d6", "#d9cbb5"];
  const BRICK = ["#9a5a44", "#8a5a46", "#a8735a"];
  const BRICK_WALL = ["#b0644c", "#a35a45", "#9c6a55", "#b87a5e"]; // 붉은 벽돌 다세대
  const APT_TINTS = ["#f1efe9", "#ece8de", "#e4e6e6", "#efe9dc", "#e6e1d5"];
  const METAL_TINTS = ["#c9d1d6", "#b7c4cc", "#d8d8d2", "#9fb2bf"];
  const TILE_TINTS = ["#4f565e", "#5a5f66", "#3f4f5e", "#6b4a3f", "#566b77"]; // 기와·슬레이트 지붕
  // 빌라 벽 색: 붉은 벽돌, 황토색 벽돌, 밝은 베이지, 회갈색 (사진 벽돌 무늬에 곱한다)
  const VILLA_TINTS = ["#c98c6c", "#b9765a", "#d7b08a", "#e3d6c2", "#c8b8a2", "#d9c3a5"];
  const HOUSE_TINTS = ["#ece4d4", "#e2d8c4", "#f0ebe1", "#d9cdb8"];
  // 지은 해에 따라 벽 색을 바래게 한다 (오래될수록 어둡고 누렇게)
  const aged = (col, year) => {
    if (!year) return col;
    const f = year < 1975 ? 0.8 : year < 1990 ? 0.88 : year < 2005 ? 0.96 : 1.04;
    const c = col.clone().multiplyScalar(f);
    if (year < 1990) c.lerp(new THREE.Color(0.55, 0.5, 0.4), 0.08);
    return c;
  };
  const ROAD_LAYER = 0.04;

  // 공간 색인: 칸마다 그 칸에 걸친 물체 번호를 둔다 (충돌 검사와 나무 배치에 쓴다)
  function makeIndex(cellSize) {
    const cells = new Map();
    return {
      add(minx, minz, maxx, maxz, item) {
        for (let cz = Math.floor(minz / cellSize); cz <= Math.floor(maxz / cellSize); cz++)
          for (let cx = Math.floor(minx / cellSize); cx <= Math.floor(maxx / cellSize); cx++) {
            const k = cx + "," + cz;
            (cells.get(k) || cells.set(k, []).get(k)).push(item);
          }
      },
      at(x, z) { return cells.get(Math.floor(x / cellSize) + "," + Math.floor(z / cellSize)) || []; },
    };
  }

  // ---------- 장면 만들기 ----------
  // avoid: 나무를 세우지 않을 지점 [{x, z}] (출발점, 목적지)
  function build(scene, renderer, map, avoid) {
    const T = textures(renderer);
    const sc = map.scenery || { buildings: [], roads: [], green: [], trees: [] };
    const group = new THREE.Group();
    const size = map.size, n = map.n, cell = map.cell;
    const ONE = new THREE.Color(1, 1, 1);

    // 바닥: 지도 밖 배경까지 보도블록을 깐다
    const span = size + MARGIN * 2 + 100;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(span, span), new THREE.MeshStandardMaterial({ map: T.ground, roughness: 0.95 }));
    T.ground.repeat.set(span / 4, span / 4);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(size / 2, 0, size / 2);
    ground.receiveShadow = true;
    group.add(ground);

    // 건물
    const BP = buf(), BR = buf(), BG = buf(), BS = buf(), BROOF = buf();
    const BBRICK = buf(), BBLOCK = buf(), BMETAL = buf(), BAPT = buf(), BTILE = buf(), BLABEL = buf(), BPLAIN = buf();
    const BVILLA = buf(), BPIL = buf(), BVSIGN = buf(); // 빌라 벽, 필로티 주차장, 세로 간판 (2026-10-21)
    const roofSpots = [], vsigns = [], roofStats = {}; // 옥상 물탱크·실외기 자리, 세로 간판 자리
    const solids = makeIndex(12); // 충돌용 건물 다각형
    const polys = [];
    const labels = []; // 아파트 동 번호 { b, pts, h }
    const bldList = []; // 거리 소품 배치용 건물 { pts, h, shop }
    // 외벽: 공공데이터의 구조(st)와 사용승인 연도(y)가 있으면 그것으로, 없으면 무작위로 고른다
    //  아파트 → 발코니 벽, 목조 저층 → 회벽 + 기와 우진각 지붕, 벽돌 → 붉은 벽돌, 블록·석조 → 회색 블록, 저층 철골 → 골함석 패널
    // 상징 건물(js/landmarks.js): 일반 상자 대신 따로 그리거나(replace), 그대로 그리고 간판을 더하거나(decorate), 숨긴다(hide)
    const lmPlan = typeof LANDMARKS !== "undefined" ? LANDMARKS.plan(map, sc.buildings, pointInPoly) : null;
    const lmBuilt = [], roofPolys = [];
    sc.buildings.forEach((b, i) => {
      const sp = lmPlan && lmPlan.get(i);
      if (sp && sp.role === "hide") return;
      if (sp && sp.role === "decorate") lmBuilt.push({ sp, pts: orient(b.p).pts, h: b.h, b });
      const { pts, area } = orient(b.p);
      const r = hash(i * 7.77);
      const isRoof = b.k === "roof", isChurch = b.k === "church", isLow = b.k === "low", isApt = b.k === "apartments", isWood = b.k === "wood";
      const h = b.h;
      const pick = (list) => aged(lin(list[Math.floor(r * list.length)]), b.y);
      const tint = isChurch ? lin(BRICK[Math.floor(r * BRICK.length)]) : pick(WALL_TINTS);
      let pitched = false;
      // 거리 소품(js/streetprops.js) 배치에 쓴다: 벽에 실외기, 1층 상가에 셔터
      if (!isRoof) bldList.push({ pts, h, shop: !isApt && !isWood && !isLow && !isChurch && area > 40 && h > SHOP_H + 2 });
      if (isRoof) {
        roofPolys.push(pts); // 시장 아케이드처럼 지붕만 있는 곳 밑에는 나무를 심지 않는다
        addWalls(BROOF, pts, 3.4, h, lin("#9b9d9f"), BAY, 4, FLOOR, 4, i, 1);
      } else {
        const minx = Math.min(...pts.map((p) => p[0])), maxx = Math.max(...pts.map((p) => p[0]));
        const minz = Math.min(...pts.map((p) => p[1])), maxz = Math.max(...pts.map((p) => p[1]));
        // res: 실외기·쓰레기봉투를 둘 만한 저층 주택류 (가게가 있으면 아래에서 shop으로 바뀐다)
        const poly = { pts, minx, maxx, minz, maxz, i, res: !isApt && !isChurch && (isLow || isWood || b.st === "b" || b.st === "k" || h <= 16) };
        polys.push(poly);
        solids.add(minx, minz, maxx, maxz, poly);
        if (sp && sp.role === "replace") { lmBuilt.push({ sp, pts, h, b }); return; }
        if (isApt) {
          // 판상형 아파트(긴 벽이 짧은 벽의 2배 이상)는 짧은 벽 두 개를 창 없는 옆벽(측벽)으로 그리고, 동 번호가 있으면 거기에 쓴다
          const edges = pts.map((a, j) => { const q = pts[(j + 1) % pts.length]; return { j, a, q, len: Math.hypot(q[0] - a[0], q[1] - a[1]) }; });
          const longest = Math.max(...edges.map((e) => e.len));
          const sides = h >= 12 ? edges.filter((e) => e.len >= 6).sort((p, q) => p.len - q.len).slice(0, 2).filter((e) => longest >= e.len * 2) : [];
          const aptTint = pick(APT_TINTS);
          addWalls(BAPT, pts, 0, h, aptTint, BAY, 4, FLOOR, 4, i, 0.82, new Set(sides.map((e) => e.j)));
          for (const e of sides) addWalls(BPLAIN, [e.a, e.q], 0, h, aptTint, e.len, 1, h, 1, i, 0.82, new Set([1]));
          if (b.dn && sides.length) labels.push({ b, sides, h });
        } else if (isWood) {
          addWalls(BP, pts, 0, h, pick(HOUSE_TINTS), BAY, 4, FLOOR, 4, i, 0.78);
          pitched = hipRoof(BTILE, pts, h, aged(lin(TILE_TINTS[Math.floor(hash(i * 3.1) * TILE_TINTS.length)]), b.y));
        } else if (b.st === "s" && h < 16 && !isChurch) {
          addWalls(BMETAL, pts, 0, h, pick(METAL_TINTS), 2, 1, h, 1, i, 0.85);
        } else if (h >= 45 && (b.m || r < 0.45) && !(b.y && b.y < 1995)) {
          addWalls(BG, pts, 0, h, lin(["#cfe0ea", "#bcd0db", "#d9e2e6"][Math.floor(r * 3)]), 3, 4, FLOOR, 4, i, 0.8);
        } else {
          const hasShop = !isLow && !isChurch && area > 40 && h > SHOP_H + 2;
          poly.shop = hasShop; // 거리 소품을 놓을 때 쓴다 (가게 앞 상자·화분, 주택 옆 실외기)
          if (hasShop) poly.res = false;
          // 구조가 있으면 벽돌·블록 벽, 없으면 창문 벽과 띠창 벽 가운데 하나 (2005년 이후 건물은 띠창을 더 자주)
          const [target, wallTint] = b.st === "b" && !isChurch ? [BBRICK, pick(BRICK_WALL)]
            : b.st === "k" ? [BBLOCK, tint]
            : [r < (b.y >= 2005 ? 0.25 : 0.5) || isChurch || isLow ? BP : BR, tint];
          // 빌라(다세대 주택): 가게 없는 2~5층 주거 건물. 2002년 뒤(연도를 모르면 절반) 4층 이상은 1층이 필로티 주차장
          const villa = !hasShop && !isChurch && !isLow && h >= 6 && h <= 17.5 && b.st !== "k";
          // 상가주택: 가게 있는 낮은 건물의 위층도 절반은 빌라 벽
          const villaTop = hasShop && h <= 14 && hash(i * 2.3) < 0.5 && b.st !== "k";
          const vTint = b.st === "b" || (b.y && b.y < 1992) ? pick(BRICK_WALL) : pick(VILLA_TINTS);
          if (hasShop) {
            addWalls(BS, pts, 0, SHOP_H, ONE, 4, 8, SHOP_H, 1, i, 0.78);
            addWalls(villaTop ? BVILLA : target, pts, SHOP_H, h, villaTop ? vTint : wallTint, BAY, 4, FLOOR, 4, i, 0.94);
            // 세로 간판: 3층 넘는 상가 건물의 가장 긴 벽 한쪽 끝 (2층부터 위로)
            if (h >= 10) {
              let best = null;
              for (let j = 0; j < pts.length; j++) { const p0 = pts[j], p1 = pts[(j + 1) % pts.length], len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); if (!best || len > best.len) best = { p0, p1, len }; }
              if (best.len >= 6) vsigns.push({ ...best, y0: SHOP_H + 0.6, y1: Math.min(h - 0.6, SHOP_H + 0.6 + 6.5), k: i });
            }
          } else if (villa) {
            const pil = h >= 12 && (b.y ? b.y >= 2002 : hash(i * 4.1) < 0.5);
            if (pil) addWalls(BPIL, pts, 0, 2.7, ONE, BAY, 4, 2.7, 1, i, 1);
            addWalls(BVILLA, pts, pil ? 2.7 : 0, h, vTint, BAY, 4, FLOOR, 4, i, pil ? 0.9 : 0.78);
          } else {
            addWalls(target, pts, 0, h, wallTint, BAY, 4, FLOOR, 4, i, 0.74);
          }
          // 옥상 물탱크·실외기 (평지붕 30m 이하, 넓이 40㎡ 넘는 건물)
          if (h <= 30 && area > 40) roofSpots.push({ pts, h, i, minx, maxx, minz, maxz });
        }
      }
      // 지붕: 한국 옥상에서 흔한 초록 방수 페인트를 일부 섞는다
      if (!pitched) polyUp(BROOF, pts, h, 8, lin(isWood ? TILE_TINTS[Math.floor(hash(i * 3.1) * TILE_TINTS.length)] : r < 0.3 ? "#6f9a7c" : r < 0.4 ? "#9aa3a8" : "#b4b1aa"));
    });

    // 아파트 동 번호: 지도 가운데에서 가까운 것부터 128개까지, 옆벽(짧은 벽 두 개) 위쪽에 "101동"과 단지 이름을 쓴다.
    // 글자는 한 장의 캔버스(2048×2048, 칸 256×128)에 모아 그린다
    let labelTex = null;
    if (labels.length) {
      labels.sort((p, q) => Math.hypot(p.sides[0].a[0] - size / 2, p.sides[0].a[1] - size / 2) - Math.hypot(q.sides[0].a[0] - size / 2, q.sides[0].a[1] - size / 2));
      const use = labels.slice(0, 128);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 2048;
      const g = canvas.getContext("2d");
      g.textAlign = "center"; g.textBaseline = "middle";
      use.forEach(({ b, sides, h }, k) => {
        const col = k % 8, row = Math.floor(k / 8), x = col * 256, y = row * 128;
        g.fillStyle = "#4a5560";
        g.font = "bold 64px 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
        g.fillText(b.dn, x + 128, y + (b.nm ? 48 : 64));
        if (b.nm) { g.font = "bold 24px 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif"; g.fillText(b.nm, x + 128, y + 104, 240); }
        const uv = { u0: x / 2048, u1: (x + 256) / 2048, v1: 1 - y / 2048, v0: 1 - (y + 128) / 2048 };
        for (const e of sides) {
          const wdt = Math.min(e.len * 0.7, 10), t0 = (e.len - wdt) / 2 / e.len, t1 = 1 - t0;
          const A = [e.a[0] + (e.q[0] - e.a[0]) * t0, e.a[1] + (e.q[1] - e.a[1]) * t0], Bq = [e.a[0] + (e.q[0] - e.a[0]) * t1, e.a[1] + (e.q[1] - e.a[1]) * t1];
          const top = h - 1.5;
          labelQuad(BLABEL, A, Bq, top - wdt / 2, top, uv, ONE);
        }
      });
      labelTex = new THREE.CanvasTexture(canvas);
      labelTex.encoding = THREE.sRGBEncoding;
      labelTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }

    // 막힌 땅: 넓게 이어진 곳은 저층 건물로 채우고, 걷는 칸과 맞닿은 나머지는 화단으로 막는다.
    // OSM에 작은 주택이 빠진 동네(서울 지역 등)에서도 거리가 비어 보이지 않게 한다.
    const blocked = (r, c) => r < 0 || c < 0 || r >= n || c >= n || map.kind[r * n + c] === 0;
    const filled = new Uint8Array(n * n);
    const LOT = Math.max(2, Math.round(10 / cell)); // 한 필지 약 10m
    for (let r0 = 0; r0 + LOT <= n; r0 += LOT) for (let c0 = 0; c0 + LOT <= n; c0 += LOT) {
      let all = true;
      for (let r = r0; r < r0 + LOT && all; r++) for (let c = c0; c < c0 + LOT && all; c++) if (!blocked(r, c)) all = false;
      if (!all) continue;
      for (let r = r0; r < r0 + LOT; r++) for (let c = c0; c < c0 + LOT; c++) filled[r * n + c] = 1;
      const k = r0 * 131 + c0;
      const floors = 2 + Math.floor(hash(k * 1.9) * 4);
      const x0 = c0 * cell + 0.3, x1 = (c0 + LOT) * cell - 0.3, z0 = r0 * cell + 0.3, z1 = (r0 + LOT) * cell - 0.3;
      const pts = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]; // (dz, -dx)가 바깥을 향하는 순서
      const h = floors * FLOOR + 0.6;
      const tint = lin(WALL_TINTS[Math.floor(hash(k) * WALL_TINTS.length)]);
      const edgeOpen = !blocked(r0 - 1, c0) || !blocked(r0 + LOT, c0) || !blocked(r0, c0 - 1) || !blocked(r0, c0 + LOT);
      if (edgeOpen && floors >= 3) {
        addWalls(BS, pts, 0, SHOP_H, ONE, 4, 8, SHOP_H, 1, k, 0.78);
        addWalls(hash(k * 3) < 0.5 ? BP : BR, pts, SHOP_H, h, tint, BAY, 4, FLOOR, 4, k, 0.94);
      } else {
        addWalls(hash(k * 3) < 0.5 ? BP : BR, pts, 0, h, tint, BAY, 4, FLOOR, 4, k, 0.74);
      }
      polyUp(BROOF, pts, h, 8, lin(hash(k * 5) < 0.3 ? "#6f9a7c" : "#b4b1aa"));
    }
    const isHedge = new Uint8Array(n * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (!blocked(r, c) || filled[r * n + c]) continue;
      let touches = false;
      for (let dr = -1; dr <= 1 && !touches; dr++) for (let dc = -1; dc <= 1 && !touches; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < n && cc < n && map.kind[rr * n + cc] === 2) touches = true;
      }
      if (touches) isHedge[r * n + c] = 1;
    }
    // 화단: 화단 칸 덩어리의 경계선을 칸 가운데 점으로 따라가서(marching squares) 모서리를 45도로 깎고,
    // 선을 단순하게 줄여서 비스듬한 길을 따라 곧게 세운다 (칸을 그대로 쌓으면 대각선 길에서 계단 모양이 됐다, 2026-10-20)
    const BHEDGE = buf(), BHEDGETOP = buf();
    const HEDGE_H = 1.1;
    const hedgeLoops = traceLoops((r, c) => r >= 0 && c >= 0 && r < n && c < n && isHedge[r * n + c] === 1, n, cell);
    // traceLoops는 화단을 늘 같은 쪽에 두고 돌므로, 넓이 부호로 바깥 고리와 구멍(화단 안의 빈 땅)을 가린다.
    // 가장 큰 고리는 늘 바깥 고리다. 벽 법선 방향은 그 고리의 원래 선분 하나로 한 번만 정한다
    const signed = (loop) => loop.reduce((acc, a, i) => { const b = loop[(i + 1) % loop.length]; return acc + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
    const raw = hedgeLoops.map((l) => ({ l, A: signed(l) }));
    const big = raw.reduce((m, q) => (!m || Math.abs(q.A) > Math.abs(m.A) ? q : m), null);
    let flip = false;
    if (big) {
      const [p, q] = big.l, L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const mx = (p[0] + q[0]) / 2 + ((q[1] - p[1]) / L) * 0.4, mz = (p[1] + q[1]) / 2 - ((q[0] - p[0]) / L) * 0.4;
      const c = Math.floor(mx / cell), r = Math.floor(mz / cell);
      flip = r >= 0 && c >= 0 && r < n && c < n && isHedge[r * n + c] === 1;
    }
    const outers = [], holes = [];
    for (const { l, A } of raw) {
      let loop = simplifyLoop(l, 0.55);
      if (loop.length < 3) continue;
      if (flip) loop = loop.slice().reverse();
      (Math.sign(A) === Math.sign(big.A) ? outers : holes).push({ pts: loop, area: Math.abs(A) });
    }
    const outerHoles = outers.map(() => []);
    for (const h of holes) {
      let best = -1;
      outers.forEach((o, k) => { if (o.area > h.area && pointInPoly(h.pts[0][0], h.pts[0][1], o.pts) && (best < 0 || o.area < outers[best].area)) best = k; });
      if (best >= 0) outerHoles[best].push(h.pts);
    }
    let hedgeSeed = 0;
    outers.forEach((o, k) => {
      const all = [o.pts, ...outerHoles[k]];
      for (const ring of all) addWalls(BHEDGE, ring, 0, HEDGE_H, ONE, 2, 1, HEDGE_H, 1, hedgeSeed++, 0.8);
      let tris = null;
      try { tris = THREE.ShapeUtils.triangulateShape(o.pts.map((p) => new THREE.Vector2(p[0], p[1])), outerHoles[k].map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])))); } catch (e) { tris = null; }
      const flat = all.flat();
      if (tris && tris.length) for (const t of tris) triUp(BHEDGETOP, flat[t[0]], flat[t[1]], flat[t[2]], HEDGE_H, 5, ONE);
    });
    const dummy = new THREE.Object3D();

    // 도로
    const roads = sc.roads.map((r) => ({ ...r, pts: r.p }));
    const nodeUse = new Map();
    const keyOf = (p) => p[0].toFixed(1) + "," + p[1].toFixed(1);
    // 교차로: 폭 5m 이상 차도끼리 만나는 꼭짓점 (tools/build_maps.mjs와 같은 규칙)
    for (const rd of roads) if (rd.k === "car" && rd.w >= 5) for (const p of rd.pts) {
      const k = keyOf(p), e = nodeUse.get(k) || { n: 0, w: 0, x: p[0], z: p[1], id: nodeUse.size };
      e.n++; e.w = Math.max(e.w, rd.w); nodeUse.set(k, e);
    }
    for (const rd of roads) {
      rd.junctions = rd.pts.filter((p) => { const e = nodeUse.get(keyOf(p)); return e && e.n >= 2; })
        .map((p) => { const node = nodeUse.get(keyOf(p)); return { x: p[0], z: p[1], trim: node.w / 2 + 2.5, node }; });
    }
    // 다리·고가(OSM bridge, layer > 0): 지면 위로 띄운다. 다른 다리와 이어지는 끝은 높이를 유지하고,
    // 지면 길과 이어지는 끝은 경사로로 내린다 (traffic.js의 차도 이 높이로 달린다)
    const DECK_H = 6.5;
    const brEnds = new Map();
    for (const rd of roads) if (rd.br) for (const p of [rd.pts[0], rd.pts[rd.pts.length - 1]]) brEnds.set(keyOf(p), (brEnds.get(keyOf(p)) || 0) + 1);
    const smooth = (u) => u * u * (3 - 2 * u);
    for (const rd of roads) {
      if (!rd.br) continue;
      const cum = [0];
      for (let i = 1; i < rd.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(rd.pts[i][0] - rd.pts[i - 1][0], rd.pts[i][1] - rd.pts[i - 1][1]));
      const L = cum[cum.length - 1], R = Math.max(8, Math.min(45, L * 0.45));
      const rampA = brEnds.get(keyOf(rd.pts[0])) < 2, rampB = brEnds.get(keyOf(rd.pts[rd.pts.length - 1])) < 2;
      rd.deck = { cum, at: (s) => DECK_H * Math.min(rampA ? smooth(Math.min(1, s / R)) : 1, rampB ? smooth(Math.min(1, (L - s) / R)) : 1) };
    }
    // 다리 위 한 점의 높이 (다리가 아니면 0)
    function deckY(rd, x, z) {
      if (!rd.deck) return 0;
      let best = Infinity, sAt = 0;
      for (let i = 0; i + 1 < rd.pts.length; i++) {
        const a = rd.pts[i], b = rd.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
        const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)) : 0;
        const d = Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
        if (d < best) { best = d; sAt = rd.deck.cum[i] + t * Math.sqrt(L2); }
      }
      return rd.deck.at(sAt);
    }
    function sample(rd, step) {
      const out = [];
      let d = 0;
      const okAt = (x, z) => rd.junctions.every((J) => Math.hypot(J.x - x, J.z - z) > J.trim);
      for (let i = 0; i < rd.pts.length - 1; i++) {
        const a = rd.pts[i], b = rd.pts[i + 1];
        const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
        if (len < 0.01) continue;
        const tx = dx / len, tz = dz / len, k = Math.max(1, Math.ceil(len / step));
        for (let j = 0; j < k; j++) {
          const s = (j / k) * len, x = a[0] + tx * s, z = a[1] + tz * s;
          out.push({ x, z, tx, tz, d: d + s, ok: okAt(x, z) });
        }
        d += len;
        if (i === rd.pts.length - 2) out.push({ x: b[0], z: b[1], tx, tz, d, ok: okAt(b[0], b[1]) });
      }
      return out;
    }
    const off = (s, o) => [s.x - s.tz * o, s.z + s.tx * o];
    const BROAD = buf(), BPLAZA = buf(), BMARK = buf(), BGREEN = buf(), BFENCE = buf();
    const kindAt = (x, z) => { const c = Math.floor(x / cell), r = Math.floor(z / cell); return r < 0 || c < 0 || r >= n || c >= n ? -1 : map.kind[r * n + c]; };
    const WHITE = lin("#e9e7e1"), YELLOW = lin("#e8b828");
    const treeSpots = [], lampSpots = [];
    const fenceSegs = []; // 세운 울타리 [a, b] (덮은 비율 점검과 빈 곳 채우기에 쓴다)
    const FENCE_H = 1.2; // 보행자 방호 울타리 높이(m)
    let fenceFill = 0;
    // 차가 다니지만 걸을 수도 있는 차도(폭 NO_SIDEWALK_BELOW~WIDE_ROAD). 울타리 바깥이 이런 차도면 보도가 아니라 세우지 않는다
    const laneSegs = [];
    for (const rd of roads) if (rd.k === "car" && !rd.br && rd.w >= CONFIG.NO_SIDEWALK_BELOW && rd.w < CONFIG.WIDE_ROAD) for (let i = 0; i + 1 < rd.pts.length; i++) laneSegs.push({ a: rd.pts[i], b: rd.pts[i + 1], hw: rd.w / 2 });
    const onLaneRoad = (x, z) => laneSegs.some((sg) => segDist2(x, z, sg.a, sg.b) < (sg.hw + 0.5) ** 2);
    // 길바닥 장식 (2026-10-21): 화강석 연석, 노란 점자블록(선형·점형), 골목 가장자리 선과 색 포장, 가로수 보호판
    const BCURB = buf(), BTACT = buf(), BDOT = buf(), BSTAMP = buf(), BGRATE = buf();
    const roadTrees = []; // 길가 가로수 자리 { x, z, yaw } (보호판을 깐다)
    // 길을 따라 깔리는 띠: 가운데가 길 중심선에서 o만큼 옆, 폭 width. u는 폭 방향(uLen m마다 1), v는 길이 방향(vLen m마다 1)
    function ribbon(B, S, o, width, y, uLen, vLen, test) {
      for (let i = 0; i < S.length - 1; i++) {
        const s = S[i], t = S[i + 1];
        if (!s.ok || !t.ok) continue;
        if (test && !(test(off(s, o)) && test(off(t, o)))) continue;
        const A = off(s, o - width / 2), Bq = off(t, o - width / 2), C = off(t, o + width / 2), D = off(s, o + width / 2);
        upQuad(B, [[A[0], A[1], 0, s.d / vLen], [Bq[0], Bq[1], 0, t.d / vLen], [C[0], C[1], width / uLen, t.d / vLen], [D[0], D[1], width / uLen, s.d / vLen]], y, ONE);
      }
    }
    // 연석: 차도 가장자리에 폭 0.3m, 윗면 높이 0.09m의 화강석 띠. 윗면과 양쪽 옆면
    function curb(S, side, hw) {
      ribbon(BCURB, S, side * (hw + 0.1), 0.3, 0.09, 0.3, 2);
      for (let i = 0; i < S.length - 1; i++) {
        const s = S[i], t = S[i + 1];
        if (!s.ok || !t.ok) continue;
        for (const e of [hw - 0.05, hw + 0.25]) vquad(BCURB, off(s, side * e), off(t, side * e), 0, 0.09, s.d / 2, t.d / 2, ONE);
      }
    }
    const walkAt = (p) => kindAt(p[0], p[1]) === 2;
    function strip(S, o, width, y, col, dash) {
      for (let i = 0; i < S.length - 1; i++) {
        const s = S[i], t = S[i + 1];
        if (!s.ok || !t.ok) continue;
        if (dash && (s.d % 8) > 3.5) continue;
        quadUp(BMARK, off(s, o - width / 2), off(t, o - width / 2), off(t, o + width / 2), off(s, o + width / 2), y, 1, col);
      }
    }
    const crossings = [];
    const soloNodes = new Map(); // OSM·중간 횡단보도 하나를 두 줄 차도가 함께 쓴다 (신호도 함께 바뀐다)
    function crosswalk(s, w, rd, node, Lpaint) {
      const L = Lpaint || 3.2;
      // 신호등은 지도 안 횡단보도에만 둔다 (지도 밖 배경 도로에는 줄무늬만 그린다)
      if (rd && s.x > -5 && s.z > -5 && s.x < size + 5 && s.z < size + 5) {
        let dx = node.x - s.x, dz = node.z - s.z;
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl; dz /= dl;
        crossings.push({ x: s.x, z: s.z, tx: s.tx, tz: s.tz, w, rd, node, toJ: [dx, dz] });
      }
      for (let o = -w / 2 + 0.75; o <= w / 2 - 0.75; o += 1) {
        const a = [s.x - s.tz * o - s.tx * L / 2, s.z + s.tx * o - s.tz * L / 2];
        const b = [s.x - s.tz * o + s.tx * L / 2, s.z + s.tx * o + s.tz * L / 2];
        const q = [-s.tz * 0.25, s.tx * 0.25];
        quadUp(BMARK, [a[0] - q[0], a[1] - q[1]], [b[0] - q[0], b[1] - q[1]], [b[0] + q[0], b[1] + q[1]], [a[0] + q[0], a[1] + q[1]], ROAD_LAYER + 0.03, 1, WHITE);
      }
    }
    const nearest = (S, d) => S.reduce((best, s) => (Math.abs(s.d - d) < Math.abs(best.d - d) ? s : best), S[0]);

    // 다리 상판: 아스팔트 윗면, 콘크리트 옆면·밑면·난간, 기둥. 경사로 가운데 낮은 부분(사람 키 높이)은 걸어서 지나가지 못하게 막는다
    const BBRIDGE = buf(), CONCRETE = lin("#b4b3ad");
    const pillarSpots = [], rampSegs = [];
    function tri3(B, p, q, r, s, col) { // 위를 향하는 삼각형 (점은 [x, y, z])
      if ((q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]) < 0) { const t = q; q = r; r = t; }
      for (const v of [p, q, r]) vtx(B, v[0], v[1], v[2], 0, 1, 0, v[0] / s, -v[2] / s, col);
    }
    function wall3(B, a, b, a2, b2, nx, nz, col) { // a→b 아래 모서리, a2→b2 위 모서리
      const L = Math.hypot(b[0] - a[0], b[2] - a[2]) / 4;
      for (const [v, u, w] of [[a, 0, 0], [b2, L, 1], [b, L, 0], [a, 0, 0], [a2, 0, 1], [b2, L, 1]]) vtx(B, v[0], v[1], v[2], nx, 0, nz, u, w, col);
    }
    function drawDeck(rd) {
      const hw = rd.w / 2, S = [];
      for (let i = 0; i + 1 < rd.pts.length; i++) {
        const a = rd.pts[i], b = rd.pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.01) continue;
        const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len, k = Math.max(1, Math.ceil(len / 4));
        for (let j = 0; j < k; j++) S.push({ x: a[0] + tx * (len * j / k), z: a[1] + tz * (len * j / k), tx, tz, y: rd.deck.at(rd.deck.cum[i] + len * j / k) });
        if (i === rd.pts.length - 2) S.push({ x: b[0], z: b[1], tx, tz, y: rd.deck.at(rd.deck.cum[i] + len) });
      }
      const side = (s, o, y) => [s.x - s.tz * o, y, s.z + s.tx * o];
      for (let i = 0; i + 1 < S.length; i++) {
        const s = S[i], t = S[i + 1], ys = s.y + ROAD_LAYER, yt = t.y + ROAD_LAYER;
        tri3(BROAD, side(s, -hw, ys), side(t, -hw, yt), side(t, hw, yt), 6, ONE);
        tri3(BROAD, side(s, -hw, ys), side(t, hw, yt), side(s, hw, ys), 6, ONE);
        if (Math.max(s.y, t.y) < 0.3) continue; // 땅에 닿은 끝부분은 상판만
        for (const sg of [-1, 1]) { // 옆면(상판 두께 0.9m)과 난간(0.9m)
          const o = sg * (hw + 0.25);
          wall3(BBRIDGE, side(s, o, Math.max(0, s.y - 0.9)), side(t, o, Math.max(0, t.y - 0.9)), side(s, o, s.y + 0.9), side(t, o, t.y + 0.9), -s.tz * sg, s.tx * sg, CONCRETE);
        }
        const yb = (y) => Math.max(0.02, y - 0.9); // 밑면
        for (const [p, q, r] of [[side(s, -hw, yb(s.y)), side(t, hw, yb(t.y)), side(t, -hw, yb(t.y))], [side(s, -hw, yb(s.y)), side(s, hw, yb(s.y)), side(t, hw, yb(t.y))]])
          for (const v of [p, q, r]) vtx(BBRIDGE, v[0], v[1], v[2], 0, -1, 0, v[0] / 4, v[2] / 4, CONCRETE);
        const mid = (s.y + t.y) / 2;
        if (mid > 0.25 && mid < 2.6) rampSegs.push({ a: [s.x, s.z], b: [t.x, t.z], hw: hw + 0.3 });
      }
      // 기둥: 높은 곳에 약 20m마다
      let acc = 0;
      for (let i = 1; i < S.length; i++) {
        acc += Math.hypot(S[i].x - S[i - 1].x, S[i].z - S[i - 1].z);
        if (acc < 20 || S[i].y < 3.5) continue;
        acc = 0;
        const s = S[i], c = 0.6, pts = [[s.x - c, s.z - c], [s.x + c, s.z - c], [s.x + c, s.z + c], [s.x - c, s.z + c]];
        addWalls(BBRIDGE, pts, 0, s.y - 0.9, CONCRETE, 1.2, 1, 1, 1, i, 0.85);
        pillarSpots.push([s.x, s.z]);
      }
    }

    for (const rd of roads) {
      if (rd.br) { drawDeck(rd); continue; } // 다리는 연석·차선·횡단보도·가로수 없이 상판만 그린다
      const plaza = rd.k === "plaza";
      const B = plaza ? BPLAZA : BROAD;
      const y = plaza ? 0.03 : ROAD_LAYER + Math.min(rd.w, 30) * 0.0005;
      // 인도 없는 골목: 아스팔트를 건물 쪽으로 1m씩 넓히고 연석을 그리지 않는다
      const bare = !plaza && rd.w < CONFIG.NO_SIDEWALK_BELOW;
      const hw = rd.w / 2 + (bare ? 1 : 0), s = plaza ? 4 : 6;
      for (let i = 0; i < rd.pts.length - 1; i++) {
        const a = rd.pts[i], b = rd.pts[i + 1];
        const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
        if (len < 0.01) continue;
        const nx = (-dz / len) * hw, nz = (dx / len) * hw;
        quadUp(B, [a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz], y, s, ONE);
      }
      for (const p of rd.pts) { // 꺾이는 곳의 빈틈을 원으로 메운다
        for (let k = 0; k < 10; k++) {
          const a0 = (k / 10) * Math.PI * 2, a1 = ((k + 1) / 10) * Math.PI * 2;
          triUp(B, p, [p[0] + Math.cos(a0) * hw, p[1] + Math.sin(a0) * hw], [p[0] + Math.cos(a1) * hw, p[1] + Math.sin(a1) * hw], y, s, ONE);
        }
      }
      if (plaza) continue;
      if (bare) {
        // 인도 없는 골목: 대부분은 양쪽 가장자리에 흰 실선(보행 공간), 다섯에 하나는 보행자 우선도로처럼 색 네모 포장
        const S = sample(rd, 2);
        if (hash(rd.pts[0][0] * 13.1 + rd.pts[0][1] * 7.7) < 0.2) ribbon(BSTAMP, S, 0, hw * 2 - 0.6, y + 0.004, 2, 2);
        else for (const side of [-1, 1]) strip(S, side * (hw - 0.6), 0.12, y + 0.006, WHITE, false);
        continue;
      }
      const S = sample(rd, 2);
      curb(S, -1, hw);
      curb(S, 1, hw);
      // 큰길 보도: 보도 가운데쯤에 노란 선형 점자블록 한 줄 (보도 위인 곳만)
      if (rd.w >= CONFIG.WIDE_ROAD) { const sw = rd.sw || 4; for (const side of [-1, 1]) ribbon(BTACT, S, side * (hw + sw * 0.6), 0.3, 0.015, 0.3, 0.3, walkAt); }
      if (rd.w < 10) continue;
      // 한국 도로: 가운데 노란 겹선, 차로 사이 흰 점선, 교차로 앞 횡단보도
      strip(S, -0.2, 0.15, ROAD_LAYER + 0.03, YELLOW, false);
      strip(S, 0.2, 0.15, ROAD_LAYER + 0.03, YELLOW, false);
      const lanes = rd.ln || Math.max(2, Math.round((rd.w - 1.5) / 3.3));
      const perDir = Math.max(1, Math.floor(lanes / 2));
      const laneW = (hw - 0.5) / perDir;
      for (let j = 1; j < perDir; j++) { strip(S, j * laneW, 0.15, ROAD_LAYER + 0.03, WHITE, true); strip(S, -j * laneW, 0.15, ROAD_LAYER + 0.03, WHITE, true); }
      const usePub = sc.crosswalkSource === "public";
      const openJ = new Set((sc.junctionsOpen || []).map(keyOf));
      const ruleOK = (J) => !usePub || openJ.has(keyOf([J.x, J.z]));
      const nearJ = (p) => rd.junctions.reduce((b, J) => (Math.hypot(J.x - p.x, J.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? J : b), rd.junctions[0]);
      for (let i = 1; i < S.length; i++) {
        if (S[i].ok && !S[i - 1].ok) { const c = nearest(S, S[i].d - 2.4), J = nearJ(c); if (ruleOK(J)) crosswalk(c, rd.w, rd, J.node); }
        if (!S[i].ok && S[i - 1].ok) { const c = nearest(S, S[i - 1].d + 2.4), J = nearJ(c); if (ruleOK(J)) crosswalk(c, rd.w, rd, J.node); }
      }
      // OSM에 등록된 횡단보도(교차로가 아닌 곳): 그 자리에 단독 신호를 둔다
      for (const [cx, cz] of sc.crossings || []) {
        const c = S.reduce((b, q) => (Math.hypot(q.x - cx, q.z - cz) < Math.hypot(b.x - cx, b.z - cz) ? q : b), S[0]);
        if (!c || !c.ok || Math.hypot(c.x - cx, c.z - cz) > hw + 20) continue; // 두 줄 차도의 다른 쪽도 같은 횡단보도로 연다
        const key = cx + "," + cz;
        const node = soloNodes.get(key) || soloNodes.set(key, { x: c.x + c.tx * 6, z: c.z + c.tz * 6, id: 100000 + soloNodes.size, w: rd.w, solo: true }).get(key);
        crosswalk(c, rd.w, rd, node);
      }
      // 보행자 방호 울타리: 막힌 차도 칸과 보도 사이에 세우고, 횡단보도와 교차로 자리는 비운다
      for (const side of [-1, 1]) {
        const blockedAt = (q) => { const p = off(q, side * (hw - 0.6)); return kindAt(p[0], p[1]) === 3; };
        // 바깥쪽(연석 밖 1~2m)이 걷는 칸일 때만 세운다 (교차로 안 회전 차로처럼 양옆이 모두 아스팔트인 곳에는 세우지 않는다)
        const walkOut = (q) => [1.0, 2.0].some((d) => { const p = off(q, side * (hw + d)); return kindAt(p[0], p[1]) === 2 && !onLaneRoad(p[0], p[1]); });
        for (let i = 0; i < S.length - 1; i++) {
          const q0 = S[i], q1 = S[i + 1];
          if (!blockedAt(q0) || !blockedAt(q1) || !walkOut(q0) || !walkOut(q1)) continue;
          let a = off(q0, side * (hw + 0.15)), b = off(q1, side * (hw + 0.15));
          if (side < 0) [a, b] = [b, a];
          vquad(BFENCE, a, b, 0.02, FENCE_H, 0, Math.hypot(b[0] - a[0], b[1] - a[1]) / 2, ONE);
          fenceSegs.push(Object.assign([a, b], { rd: rd.w }));
        }
      }
      sample(rd, 9).forEach((sp, k) => {
        if (!sp.ok) return;
        for (const side of [-1, 1]) {
          const tp = off(sp, side * (hw + 1.6));
          treeSpots.push(tp);
          roadTrees.push({ x: tp[0], z: tp[1], yaw: Math.atan2(sp.tx, sp.tz) });
          if (k % 3 === (side > 0 ? 0 : 1)) lampSpots.push({ p: off(sp, side * (hw + 0.5)), yaw: Math.atan2(sp.tx, sp.tz) + (side > 0 ? Math.PI : 0) });
        }
      });
    }

    // 공공데이터 횡단보도 (서울시·대구시 횡단보도 도형을 지도 생성 때 사각형으로 정리한 것)
    const allJ = [...nodeUse.values()].filter((e) => e.n >= 2);
    // 공공 도형은 OSM 차도와 조금 어긋나거나 더 길 수 있어서, 줄무늬는 차도 노면 위에 있는 구간만 그린다
    const carIdx = makeIndex(20);
    for (const rd of roads) if (rd.k === "car" && !rd.br) for (let i = 0; i < rd.pts.length - 1; i++) {
      const a = rd.pts[i], b = rd.pts[i + 1], hw = rd.w / 2;
      carIdx.add(Math.min(a[0], b[0]) - hw, Math.min(a[1], b[1]) - hw, Math.max(a[0], b[0]) + hw, Math.max(a[1], b[1]) + hw, { a, b, hw });
    }
    const onCarSurface = (x, z) => carIdx.at(x, z).some((s) => segDist2(x, z, s.a, s.b) <= s.hw * s.hw);
    for (const cw0 of sc.crosswalks || []) {
      let lo = Infinity, hi = -Infinity;
      for (let s = -cw0.W / 2; s <= cw0.W / 2; s += 0.25) if (onCarSurface(cw0.x - cw0.tz * s, cw0.z + cw0.tx * s)) { lo = Math.min(lo, s); hi = Math.max(hi, s); }
      // 차도 노면과 거의 겹치지 않으면(OSM 차도가 크게 어긋난 곳) 원래 도형대로 그린다. 걷는 판정에서는 그 자리가 열려 있다
      const fit = hi - lo >= 2, mid = fit ? (lo + hi) / 2 : 0;
      const cw = fit ? { ...cw0, x: cw0.x - cw0.tz * mid, z: cw0.z + cw0.tx * mid, W: hi - lo + 0.25 } : cw0;
      const sp = { x: cw.x, z: cw.z, tx: cw.tx, tz: cw.tz };
      if (!cw.wide) { crosswalk(sp, cw.W, null, null, cw.L); continue; }
      // 가장 가까운 큰 차도와, 30m 안의 교차로(없으면 이 횡단보도만의 신호)를 찾는다
      let rdBest = null, dBest = Infinity;
      for (const rd of roads) {
        if (rd.k !== "car" || rd.w < CONFIG.WIDE_ROAD || rd.br) continue; // 고가 위 차가 아래 횡단보도 신호에 서지 않게
        for (let i = 0; i < rd.pts.length - 1; i++) {
          const a = rd.pts[i], b = rd.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
          if (L2 < 0.01) continue;
          const t = Math.max(0, Math.min(1, ((cw.x - a[0]) * dx + (cw.z - a[1]) * dz) / L2));
          const d = Math.hypot(a[0] + dx * t - cw.x, a[1] + dz * t - cw.z);
          if (d < dBest) { dBest = d; rdBest = rd; }
        }
      }
      const jn = allJ.reduce((b, e) => (Math.hypot(e.x - cw.x, e.z - cw.z) < (b ? Math.hypot(b.x - cw.x, b.z - cw.z) : 30) ? e : b), null);
      const key = "pub:" + Math.round(cw.x) + "," + Math.round(cw.z);
      const node = jn || soloNodes.get(key) || soloNodes.set(key, { x: cw.x + cw.tx * 6, z: cw.z + cw.tz * 6, id: 200000 + soloNodes.size, w: cw.W, solo: true }).get(key);
      crosswalk(sp, cw.W, rdBest, node, cw.L);
    }

    // 녹지와 광장
    for (const g of sc.green) {
      const { pts, area } = orient(g.p);
      if (g.k === "water") continue; // 물은 아래에서 따로 그린다
      const isPlaza = g.k === "plaza" || g.k === "parking";
      if (isPlaza) { polyUp(BPLAZA, pts, 0.028, 4, ONE); continue; }
      polyUp(BGREEN, pts, 0.025, 5, ONE);
      if (!/park|garden|wood|forest|village_green|recreation_ground/.test(g.k)) continue;
      const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
      const minx = Math.min(...xs), maxx = Math.max(...xs), minz = Math.min(...zs), maxz = Math.max(...zs);
      const count = Math.min(220, Math.floor(area / 120));
      for (let k = 0; k < count * 3 && k < 700; k++) {
        const x = minx + hash(k * 2.1 + area) * (maxx - minx), z = minz + hash(k * 3.7 + area) * (maxz - minz);
        if (pointInPoly(x, z, pts)) treeSpots.push([x, z]);
      }
    }
    for (const t of sc.trees) treeSpots.push(t);

    // ---------- 지도 밖 배경 ----------
    // OSM에 건물이 없는 바깥 빈 땅도 저층 건물로 채워서, 지도 밖이 허허벌판으로 보이지 않게 한다.
    // 길(차도 + 보도)과 공원·물 위에는 세우지 않는다.
    const roadIdx = makeIndex(20);
    for (const rd of roads) for (let i = 0; i < rd.pts.length - 1; i++) {
      const a = rd.pts[i], b = rd.pts[i + 1], pad = rd.w / 2 + 5;
      roadIdx.add(Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad, { a, b, pad, car: rd.k === "car" && !rd.br });
    }
    const greenIdx = makeIndex(40);
    for (const g of sc.green) {
      const xs = g.p.map((p) => p[0]), zs = g.p.map((p) => p[1]);
      greenIdx.add(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), g.p);
    }
    const nearRoad = (x, z, extra) => roadIdx.at(x, z).some((s) => segDist2(x, z, s.a, s.b) < (s.pad + extra) ** 2);
    const onGreen = (x, z) => greenIdx.at(x, z).some((p) => pointInPoly(x, z, p));
    const onBuilding = (x, z) => solids.at(x, z).some((p) => x >= p.minx && x <= p.maxx && z >= p.minz && z <= p.maxz && pointInPoly(x, z, p.pts));
    const OLOT = 10;
    for (let z0 = -MARGIN; z0 < size + MARGIN; z0 += OLOT) for (let x0 = -MARGIN; x0 < size + MARGIN; x0 += OLOT) {
      const x1 = x0 + OLOT, z1 = z0 + OLOT;
      if (x1 > -2 && x0 < size + 2 && z1 > -2 && z0 < size + 2) continue; // 지도 안(과 가장자리)은 위에서 채웠다
      const cx = x0 + OLOT / 2, cz = z0 + OLOT / 2;
      if (nearRoad(cx, cz, 2)) continue;
      const probes = [[cx, cz], [x0 + 1, z0 + 1], [x1 - 1, z0 + 1], [x0 + 1, z1 - 1], [x1 - 1, z1 - 1]];
      if (probes.some(([x, z]) => onBuilding(x, z) || onGreen(x, z) || nearRoad(x, z, -3))) continue;
      const k = Math.round(x0 * 7.3 + z0 * 131.7);
      const r = hash(k * 1.9);
      const floors = r < 0.12 ? 8 + Math.floor(hash(k) * 10) : 2 + Math.floor(r * 4); // 가끔 높은 건물을 섞어 스카이라인을 만든다
      const pts = [[x0 + 0.4, z0 + 0.4], [x1 - 0.4, z0 + 0.4], [x1 - 0.4, z1 - 0.4], [x0 + 0.4, z1 - 0.4]];
      const h = floors * FLOOR + 0.6;
      const tint = lin(WALL_TINTS[Math.floor(hash(k * 2.7) * WALL_TINTS.length)]);
      if (nearRoad(cx, cz, 8) && floors <= 5) {
        addWalls(BS, pts, 0, SHOP_H, ONE, 4, 8, SHOP_H, 1, k, 0.78);
        addWalls(hash(k * 3) < 0.5 ? BP : BR, pts, SHOP_H, h, tint, BAY, 4, FLOOR, 4, k, 0.94);
      } else {
        addWalls(hash(k * 3) < 0.5 ? BP : BR, pts, 0, h, tint, BAY, 4, FLOOR, 4, k, 0.74);
      }
      polyUp(BROOF, pts, h, 8, lin(hash(k * 5) < 0.3 ? "#6f9a7c" : "#b4b1aa"));
    }

    // ---------- 지도 가장자리 가림막 ----------
    // 걷는 길이 지도 가장자리에 닿는 곳마다 공사 가림막을 세워 "공사 중이라 못 지나간다"는 것을 보여 준다.
    // 넓은 길은 흰·파란 가림막 판넬 + 앞쪽 줄무늬 바리케이드와 라바콘, 좁은 길은 줄무늬 바리케이드와 라바콘만 둔다.
    const BPANEL = buf(), BSTRIPE = buf(), BPOST = buf();
    const conePos = [], lampPos = [];
    const DARK = lin("#3b3e42");
    const exits = [];
    const edges = [
      { cellAt: (k) => k, along: (t) => [t, 0], inward: [0, 1] },                       // 북쪽
      { cellAt: (k) => (n - 1) * n + k, along: (t) => [t, size], inward: [0, -1] },     // 남쪽
      { cellAt: (k) => k * n, along: (t) => [0, t], inward: [1, 0] },                   // 서쪽
      { cellAt: (k) => k * n + n - 1, along: (t) => [size, t], inward: [-1, 0] },       // 동쪽
    ];
    for (const e of edges) {
      for (let k = 0; k < n; k++) {
        if (map.kind[e.cellAt(k)] !== 2) continue;
        let k1 = k;
        while (k1 + 1 < n && map.kind[e.cellAt(k1 + 1)] === 2) k1++;
        exits.push({ e, t0: k * cell, t1: (k1 + 1) * cell });
        k = k1;
      }
    }
    // 판넬과 기둥 한 줄: from~to를 따라 inward 방향으로 off만큼 들어간 곳에 세운다
    const line = (e, t0, t1, off) => [
      [e.along(t0)[0] + e.inward[0] * off, e.along(t0)[1] + e.inward[1] * off],
      [e.along(t1)[0] + e.inward[0] * off, e.along(t1)[1] + e.inward[1] * off],
    ];
    function postAt(p, h) {
      const s = 0.06;
      const pts = [[p[0] - s, p[1] - s], [p[0] + s, p[1] - s], [p[0] + s, p[1] + s], [p[0] - s, p[1] + s]];
      addWalls(BPOST, pts, 0, h, DARK, 1, 1, h, 1, 0, 1);
    }
    exits.forEach((x, i) => {
      const w = x.t1 - x.t0;
      // 가림막이 길 양쪽 끝의 건물·화단과 맞닿도록 1m씩 더 늘린다
      const t0 = x.t0 - 1, t1 = x.t1 + 1;
      if (w >= 6) {
        let [a, b] = line(x.e, t0, t1, 0.3);
        if ((b[1] - a[1]) * x.e.inward[0] - (b[0] - a[0]) * x.e.inward[1] < 0) [a, b] = [b, a];
        const panels = Math.max(1, Math.round((t1 - t0) / 2));
        vquad(BPANEL, a, b, 0.05, 2.4, (i % 4) / 4 + panels / 4, (i % 4) / 4, ONE);
        for (let p = 0; p <= panels; p++) postAt([a[0] + (b[0] - a[0]) * (p / panels), a[1] + (b[1] - a[1]) * (p / panels)], 2.5);
      }
      // 줄무늬 바리케이드: 판넬 앞(또는 좁은 길에서는 단독으로) 1.0m 안쪽에 두 줄
      const bw = w >= 6 ? Math.min(6, w * 0.6) : w + 2;
      const groups = w >= 6 ? Math.max(1, Math.round(w / 30)) : 1;
      for (let gi = 0; gi < groups; gi++) {
        const mid = x.t0 + (w / groups) * (gi + 0.5);
        const [c, d] = line(x.e, mid - bw / 2, mid + bw / 2, w >= 6 ? 1.0 : 0.6);
        for (const y of [0.55, 0.92]) vquad(BSTRIPE, c, d, y, y + 0.22, 0, bw, ONE);
        postAt(c, 1.15); postAt(d, 1.15);
        lampPos.push([c[0], c[1]], [d[0], d[1]]);
        // 라바콘: 바리케이드 앞에 2~4개를 조금씩 흐트러뜨려 놓는다
        const cones = Math.min(4, Math.max(1, Math.floor(bw / 1.5)));
        for (let k = 0; k < cones; k++) {
          const t = mid - bw / 2 + (bw / cones) * (k + 0.5) + (hash(i * 13 + gi * 7 + k) - 0.5) * 0.5;
          conePos.push(line(x.e, t, t, 1.4 + hash(i * 3 + k) * 0.2)[0]);
        }
      }
      // 긴 가림막에는 사이사이에 라바콘을 드문드문 둔다
      if (w >= 6) for (let t = x.t0 + 4; t < x.t1 - 4; t += 9 + hash(t) * 6) conePos.push(line(x.e, t, t, 1.3)[0]);
    });

    // 물(강, 호수)
    const BWATER = buf();
    for (const g of sc.green) if (g.k === "water") polyUp(BWATER, orient(g.p).pts, 0.03, 10, ONE);

    const poly = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };
    const std = (map, extra) => new THREE.MeshStandardMaterial(Object.assign({ map, vertexColors: true, roughness: 0.9, metalness: 0 }, extra || {}));
    group.add(toMesh(BROAD, std(T.asphalt, Object.assign({ roughness: 0.85 }, poly))));
    group.add(toMesh(BPLAZA, std(T.plaza, poly)));
    group.add(toMesh(BGREEN, std(T.grass, Object.assign({ roughness: 1 }, poly))));
    group.add(toMesh(BHEDGE, std(T.hedge, { roughness: 1 }), true));
    group.add(toMesh(BHEDGETOP, std(T.grass, { roughness: 1 }), true));
    group.add(toMesh(BMARK,new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
    group.add(toMesh(BP, std(T.punched), true));
    group.add(toMesh(BR, std(T.ribbon), true));
    group.add(toMesh(BG, std(T.glass, { roughness: 0.35 }), true));
    group.add(toMesh(BS, std(T.shop, { roughness: 0.6 }), true));
    group.add(toMesh(BROOF, std(T.roof, { roughness: 1 }), true));
    group.add(toMesh(BBRICK, std(T.brick), true));
    group.add(toMesh(BVILLA, std(T.villa), true), toMesh(BPIL, std(T.piloti, { roughness: 1 }), true));
    const lmTick = lmPlan ? LANDMARKS.build({ group, map, built: lmBuilt, pillarSpots, buf, toMesh, std, T, addWalls, polyUp, orient, vtx, lin, ONE, renderer, hash, canvasTex, BAY, FLOOR }) : null;
    // 세로 돌출 간판: 벽에 직각으로 0.9m 튀어나온 판. 글자는 업종 이름 16가지를 한 장(1024×512, 칸 64×512)에 모아 그린다
    if (vsigns.length) {
      const canvas = document.createElement("canvas");
      canvas.width = 1024; canvas.height = 512;
      const g = canvas.getContext("2d");
      VERT_WORDS.forEach((word, k) => {
        const x = k * 64, c = SIGN_COLORS[Math.floor(hash(k * 5.3 + 7) * SIGN_COLORS.length)];
        g.fillStyle = c; g.fillRect(x, 0, 64, 512);
        g.fillStyle = "rgba(255,255,255,0.85)"; g.fillRect(x + 4, 4, 56, 4); g.fillRect(x + 4, 504, 56, 4);
        g.fillStyle = c === "#f4f1ea" || c === "#f2c230" ? "#1b1b1b" : "#fbfaf6";
        g.font = "bold 46px 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
        g.textAlign = "center"; g.textBaseline = "middle";
        const chars = [...word.replace("PC", "Ⓟ")].map((ch) => (ch === "Ⓟ" ? "PC" : ch)), step = Math.min(64, 440 / chars.length);
        chars.forEach((ch, j) => { g.font = `bold ${ch.length > 1 ? 30 : 46}px 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif`; g.fillText(ch, x + 32, 256 + (j - (chars.length - 1) / 2) * step); });
      });
      const vtex = new THREE.CanvasTexture(canvas);
      vtex.encoding = THREE.sRGBEncoding; vtex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      for (const v of vsigns) {
        const dx = (v.p1[0] - v.p0[0]) / v.len, dz = (v.p1[1] - v.p0[1]) / v.len, nx = dz, nz = -dx; // 바깥 법선 (dz, -dx)
        const t = 0.6 + hash(v.k * 1.9) * Math.max(0, v.len - 1.8), bx = v.p0[0] + dx * t, bz = v.p0[1] + dz * t;
        const A = [bx + nx * 0.1, bz + nz * 0.1], Bq = [bx + nx * 1.0, bz + nz * 1.0];
        const slot = Math.floor(hash(v.k * 3.3) * VERT_WORDS.length), u0 = slot / 16, u1 = (slot + 1) / 16;
        const fx = dx, fz = dz; // 판의 법선은 벽 방향
        const put = (p, y, u, vv) => vtx(BVSIGN, p[0], y, p[1], fx, 0, fz, u, vv, ONE);
        put(A, v.y0, u0, 0); put(Bq, v.y0, u1, 0); put(Bq, v.y1, u1, 1);
        put(A, v.y0, u0, 0); put(Bq, v.y1, u1, 1); put(A, v.y1, u0, 1);
      }
      group.add(toMesh(BVSIGN, new THREE.MeshStandardMaterial({ map: vtex, vertexColors: true, side: THREE.DoubleSide, roughness: 0.5, emissive: 0x222222 }), true));
    }
    // 옥상 물탱크(하늘색·흰색 FRP 원통)와 실외기(흰 상자). 같은 모양을 여러 번 그린다(InstancedMesh)
    {
      const tanks = [], acs = [];
      for (const r of roofSpots) {
        const inside = (x, z) => pointInPoly(x, z, r.pts);
        const cx = r.pts.reduce((a, p) => a + p[0], 0) / r.pts.length, cz = r.pts.reduce((a, p) => a + p[1], 0) / r.pts.length;
        if (hash(r.i * 1.31) < 0.55) {
          const tx = cx + (hash(r.i * 2.7) - 0.5) * (r.maxx - r.minx) * 0.4, tz = cz + (hash(r.i * 3.9) - 0.5) * (r.maxz - r.minz) * 0.4;
          if (inside(tx, tz) && inside(tx + 0.8, tz) && inside(tx - 0.8, tz) && inside(tx, tz + 0.8) && inside(tx, tz - 0.8)) tanks.push([tx, r.h, tz, hash(r.i * 5.1) < 0.6]);
        }
        const n = Math.floor(hash(r.i * 6.3) * 3);
        for (let k = 0; k < n; k++) {
          const ax = r.minx + (0.15 + hash(r.i * 7.1 + k) * 0.7) * (r.maxx - r.minx), az = r.minz + (0.15 + hash(r.i * 8.3 + k) * 0.7) * (r.maxz - r.minz);
          if (inside(ax, az) && inside(ax + 0.6, az + 0.6) && inside(ax - 0.6, az - 0.6)) acs.push([ax, r.h, az, hash(r.i + k * 4.4) * Math.PI]);
        }
      }
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
      if (tanks.length) {
        const geo = new THREE.CylinderGeometry(0.75, 0.75, 1.6, 12); geo.translate(0, 0.8, 0);
        const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 }), tanks.length);
        tanks.forEach(([x, y, z, blue], k) => { im.setMatrixAt(k, m4.compose(new THREE.Vector3(x, y, z), q.identity(), one)); im.setColorAt(k, lin(blue ? "#9fc7d9" : "#eeeeea")); });
        im.castShadow = im.receiveShadow = true; group.add(im);
      }
      if (acs.length) {
        const geo = new THREE.BoxGeometry(0.9, 0.75, 0.42); geo.translate(0, 0.375, 0);
        const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: lin("#e6e6e1"), roughness: 0.6 }), acs.length);
        acs.forEach(([x, y, z, yaw], k) => im.setMatrixAt(k, m4.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, yaw), one)));
        im.castShadow = im.receiveShadow = true; group.add(im);
      }
      roofStats.tanks = tanks.length; roofStats.acs = acs.length;
    }
    group.add(toMesh(BBLOCK, std(T.block), true));
    group.add(toMesh(BMETAL, std(T.metal, { roughness: 0.6, metalness: 0.15 }), true));
    group.add(toMesh(BAPT, std(T.apt), true));
    group.add(toMesh(BTILE, std(T.tile, { roughness: 0.8 }), true));
    group.add(toMesh(BPLAIN, std(T.roof), true)); // 아파트 옆벽: 창 없는 민벽
    if (labelTex) {
      const m = toMesh(BLABEL, std(labelTex, { transparent: true, alphaTest: 0.3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      m.material.userData.ownMap = true; // 지역마다 새로 만든 텍스처라 장면을 치울 때 함께 해제한다 (js/game.js)
      group.add(m);
    }
    group.add(toMesh(BWATER, new THREE.MeshStandardMaterial({ color: lin("#5f8296"), roughness: 0.25, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
    group.add(toMesh(BBRIDGE, std(T.roof, { side: THREE.DoubleSide, roughness: 0.95 }), true));
    group.add(toMesh(BPANEL, std(T.panel, { side: THREE.DoubleSide, roughness: 0.7 }), true));
    group.add(toMesh(BSTRIPE, std(T.stripes, { side: THREE.DoubleSide, roughness: 0.6 }), true));
    group.add(toMesh(BPOST, std(null, { roughness: 0.8 }), true));

    // 라바콘과 바리케이드 위 경고등 (경고등은 천천히 깜빡인다)
    const coneGeo = new THREE.ConeGeometry(0.2, 0.72, 14, 1, true); coneGeo.translate(0, 0.4, 0);
    const baseGeo = new THREE.BoxGeometry(0.44, 0.05, 0.44); baseGeo.translate(0, 0.025, 0);
    const coneMesh = new THREE.InstancedMesh(coneGeo, new THREE.MeshStandardMaterial({ map: T.cone, roughness: 0.6 }), Math.max(1, conePos.length));
    const baseMesh = new THREE.InstancedMesh(baseGeo, new THREE.MeshStandardMaterial({ color: lin("#26282b"), roughness: 0.9 }), Math.max(1, conePos.length));
    coneMesh.count = baseMesh.count = conePos.length;
    const lampGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16); lampGeo.translate(0, 1.25, 0);
    const lampMat = new THREE.MeshStandardMaterial({ color: lin("#f2a12a"), emissive: lin("#ffb02e"), emissiveIntensity: 1.5, roughness: 0.4 });
    const warnMesh = new THREE.InstancedMesh(lampGeo, lampMat, Math.max(1, lampPos.length));
    warnMesh.count = lampPos.length;
    {
      const m = new THREE.Object3D();
      conePos.forEach((p, i) => { m.position.set(p[0], 0, p[1]); m.rotation.set(0, hash(i) * 6.28, 0); m.updateMatrix(); coneMesh.setMatrixAt(i, m.matrix); baseMesh.setMatrixAt(i, m.matrix); });
      lampPos.forEach((p, i) => { m.position.set(p[0], 0, p[1]); m.rotation.set(0, 0, 0); m.updateMatrix(); warnMesh.setMatrixAt(i, m.matrix); });
    }
    coneMesh.castShadow = baseMesh.castShadow = true;
    group.add(coneMesh, baseMesh, warnMesh);
    // 울타리 빈 곳 채우기: 길 옆선만 따라 세우면 교차로 모서리·굽은 길·길이 합쳐지는 곳에서 경계의 15~26%가 비었다 (2026-10-20 측정).
    // 막힌 차도 칸 덩어리의 경계선을 따라가서, 바깥이 걷는 칸이고 2.5m 안에 울타리가 없는 곳에 2m 이하 조각으로 세운다 (횡단보도 자리는 비운다)
    {
      const G = 10, idx = new Map(), at = (x, z) => Math.floor(x / G) + "," + Math.floor(z / G);
      const addIdx = (sg) => { for (let t = 0; t <= 1; t += 0.25) { const k = at(sg[0][0] + (sg[1][0] - sg[0][0]) * t, sg[0][1] + (sg[1][1] - sg[0][1]) * t); (idx.get(k) || idx.set(k, []).get(k)).push(sg); } };
      fenceSegs.forEach(addIdx);
      const idxNear = (x, z, r) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const sg of idx.get((Math.floor(x / G) + a) + "," + (Math.floor(z / G) + b)) || []) if (segDist2(x, z, sg[0], sg[1]) < r * r) return true; return false; };
      const fenced = (x, z) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const sg of idx.get((Math.floor(x / G) + a) + "," + (Math.floor(z / G) + b)) || []) if (segDist2(x, z, sg[0], sg[1]) < 6.25) return true; return false; };
      const atCrossing = (x, z) => crossings.some((q) => Math.abs((x - q.x) * q.tx + (z - q.z) * q.tz) < 7 && Math.abs(-(x - q.x) * q.tz + (z - q.z) * q.tx) < q.w / 2 + 5);
      const carCell = (r, c) => r >= 0 && c >= 0 && r < n && c < n && map.kind[r * n + c] === 3;
      // 지도 칸 경계는 그린 연석과 1~2m 어긋난다. 큰길(막힌 차도) 연석선 근처의 조각만 그 연석선 위로 옮겨 세우고,
      // 차가 다니는 작은 차도(폭 NO_SIDEWALK_BELOW~WIDE_ROAD, 걸을 수 있음) 입구는 막지 않는다
      const wideSegs = [];
      for (const rd of roads) if (rd.k === "car" && !rd.br && rd.w >= CONFIG.WIDE_ROAD) for (let i = 0; i + 1 < rd.pts.length; i++) wideSegs.push({ a: rd.pts[i], b: rd.pts[i + 1], hw: rd.w / 2 });
      const curbSnap = (x, z) => {
        let best = null;
        for (const sg of wideSegs) {
          const dx = sg.b[0] - sg.a[0], dz = sg.b[1] - sg.a[1], L2 = dx * dx + dz * dz || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - sg.a[0]) * dx + (z - sg.a[1]) * dz) / L2));
          const px = sg.a[0] + dx * t, pz = sg.a[1] + dz * t, d = Math.hypot(x - px, z - pz);
          if (Math.abs(d - sg.hw) < 1.8 && (!best || Math.abs(d - sg.hw) < best.e)) best = { e: Math.abs(d - sg.hw), px, pz, d, hw: sg.hw };
        }
        if (!best || best.d < 0.01) return null;
        const k = (best.hw + 0.15) / best.d, sx = best.px + (x - best.px) * k, sz = best.pz + (z - best.pz) * k;
        // 옮긴 거리가 1.5m 이하이고, 옮긴 자리 바깥쪽 1m가 걷는 칸일 때만 (교차로 한가운데에서 다른 큰길 연석선으로 붙지 않게)
        const ox = (x - best.px) / best.d, oz = (z - best.pz) / best.d;
        if (Math.hypot(sx - x, sz - z) > 1.5 || kindAt(sx + ox, sz + oz) !== 2 || onLaneRoad(sx + ox, sz + oz)) return null;
        return [sx, sz];
      };
      for (const loop of traceLoops(carCell, n, cell)) {
        const L = simplifyLoop(loop, 0.55);
        for (let i = 0; i < L.length; i++) {
          const p = L[i], q = L[(i + 1) % L.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (len < 0.3) continue;
          const k = Math.max(1, Math.ceil(len / 2)), nx = (q[1] - p[1]) / len, nz = -(q[0] - p[0]) / len;
          for (let j = 0; j < k; j++) {
            const a = [p[0] + (q[0] - p[0]) * j / k, p[1] + (q[1] - p[1]) * j / k], b = [p[0] + (q[0] - p[0]) * (j + 1) / k, p[1] + (q[1] - p[1]) * (j + 1) / k];
            const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
            // 한쪽은 걷는 칸, 다른 쪽은 막힌 차도여야 한다 (법선 방향은 고리 방향에 따라 다르므로 양쪽을 본다)
            const k1 = kindAt(mx + nx * 0.8, mz + nz * 0.8), k2 = kindAt(mx - nx * 0.8, mz - nz * 0.8);
            if (!((k1 === 2 && k2 === 3) || (k1 === 3 && k2 === 2))) continue;
            if (mx < EDGE_BAND + 2 || mz < EDGE_BAND + 2 || mx > size - EDGE_BAND - 2 || mz > size - EDGE_BAND - 2) continue;
            if (atCrossing(mx, mz) || fenced(mx, mz) || onLaneRoad(mx, mz)) continue;
            const sa = curbSnap(a[0], a[1]), sb = curbSnap(b[0], b[1]);
            if (!sa || !sb || Math.hypot(sb[0] - sa[0], sb[1] - sa[1]) < 0.3 || Math.hypot(sb[0] - sa[0], sb[1] - sa[1]) > 3) continue;
            if (fenced((sa[0] + sb[0]) / 2, (sa[1] + sb[1]) / 2) && fenceFill >= 0 && idxNear((sa[0] + sb[0]) / 2, (sa[1] + sb[1]) / 2, 0.6)) continue;
            vquad(BFENCE, sa, sb, 0.02, FENCE_H, 0, Math.hypot(sb[0] - sa[0], sb[1] - sa[1]) / 2, ONE);
            const sg = [sa, sb]; fenceSegs.push(sg); addIdx(sg); fenceFill++;
          }
        }
      }
    }
    group.add(toMesh(BFENCE, std(T.fence, { side: THREE.DoubleSide, alphaTest: 0.5, roughness: 0.6 }), true));
    // 횡단보도 앞 노란 점형 블록: 연석 바로 뒤 보도에 길이 3m × 폭 0.6m (보도 위인 곳만)
    for (const c of crossings) {
      const nx = -c.tz, nz = c.tx;
      for (const side of [-1, 1]) {
        const cx = c.x + nx * side * (c.w / 2 + 0.75), cz = c.z + nz * side * (c.w / 2 + 0.75);
        if (kindAt(cx, cz) !== 2) continue;
        const P = (a, b) => [cx + c.tx * a + nx * b, cz + c.tz * a + nz * b];
        upQuad(BDOT, [[...P(-1.5, -0.3), 0, 0], [...P(1.5, -0.3), 10, 0], [...P(1.5, 0.3), 10, 2], [...P(-1.5, 0.3), 0, 2]], 0.016, ONE);
      }
    }
    const deco = (map) => std(map, { side: THREE.DoubleSide, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    group.add(toMesh(BCURB, std(T.curb, { side: THREE.DoubleSide, roughness: 0.8 })));
    group.add(toMesh(BTACT, deco(T.tactLine)), toMesh(BDOT, deco(T.tactDot)), toMesh(BSTAMP, deco(T.stamp)));
    if (map.underpass) drawUnderpass(group, map.underpass, solids, renderer.capabilities.getMaxAnisotropy());

    // ---------- 신호등 ----------
    // 교차로마다 두 방향 묶음이 번갈아 통행한다. 차량 신호: 초록 → 노랑 → 빨강.
    // 보행 신호: 그 길의 차량이 멈춘 동안 초록, 끝나기 전 몇 초는 깜빡임.
    const G = CONFIG.SIGNAL_GREEN, Y = CONFIG.SIGNAL_YELLOW, T2 = (G + Y) * 2;
    for (const c of crossings) {
      const nd = c.node;
      if (nd.ref === undefined) nd.ref = Math.atan2(c.toJ[1], c.toJ[0]);
      const a = Math.atan2(c.toJ[1], c.toJ[0]);
      c.phase = Math.abs(Math.cos(a - nd.ref)) >= 0.707 ? 0 : 1;
      if (nd.offset === undefined) nd.offset = hash(nd.id * 3.17) * T2;
    }
    function signalOf(c, t) {
      const u = (t + c.node.offset) % T2;
      const active = u < G + Y ? 0 : 1, within = u - active * (G + Y);
      const car = active === c.phase ? (within < G ? "green" : "yellow") : "red";
      const ped = active !== c.phase && within < G ? (within > G - CONFIG.PED_FLASH ? "flash" : "green") : "red";
      return { car, ped };
    }
    const right = (d) => [-d[1], d[0]]; // 진행 방향의 오른쪽
    const pedHeads = [], carHeads = [];
    for (const c of crossings) {
      const hw = c.w / 2, n = [-c.tz, c.tx];
      // 보행 신호등: 횡단보도 양 끝 보도 위, 건너편을 바라본다
      for (const side of [-1, 1]) {
        const x = c.x + n[0] * side * (hw + 0.9), z = c.z + n[1] * side * (hw + 0.9);
        if (kindAt(x, z) !== 2) continue;
        pedHeads.push({ c, x, z, yaw: Math.atan2(-n[0] * side, -n[1] * side) });
      }
      // 차량 신호등: 교차로로 들어오는 차가 보도록, 진행 방향 오른쪽 보도에 기둥을 세우고 팔을 길 위로 뻗는다
      const r = right(c.toJ);
      const px = c.x + r[0] * (hw + 1.0) - c.toJ[0] * 2.5, pz = c.z + r[1] * (hw + 1.0) - c.toJ[1] * 2.5;
      if (kindAt(px, pz) === 2) carHeads.push({ c, x: px, z: pz, yaw: Math.atan2(c.toJ[0], c.toJ[1]), reach: Math.min(hw * 0.75, 7) });
    }
    const darkMat = new THREE.MeshStandardMaterial({ color: lin("#2b2e31"), roughness: 0.7 });
    const lampMats = (n) => new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const m4 = new THREE.Object3D();
    const inst = (geo, mat, list) => { const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)); im.count = list.length; return im; };
    const place = (im, list, fn) => list.forEach((h, i) => { m4.position.set(h.x, 0, h.z); m4.rotation.set(0, h.yaw, 0); m4.scale.set(1, 1, 1); m4.updateMatrix(); im.setMatrixAt(i, m4.matrix); if (fn) fn(i, h); });
    // 보행 신호등: 기둥 2.8m, 함 0.38 × 0.8m, 위 빨간 사람 / 아래 초록 사람
    const pPole = new THREE.CylinderGeometry(0.06, 0.07, 3.0, 6); pPole.translate(0, 1.5, 0);
    const pBox = new THREE.BoxGeometry(0.38, 0.8, 0.2); pBox.translate(0, 2.55, 0.12);
    const pRed = new THREE.PlaneGeometry(0.26, 0.26); pRed.translate(0, 2.74, 0.225);
    const pGreen = new THREE.PlaneGeometry(0.26, 0.26); pGreen.translate(0, 2.36, 0.225);
    const pedPoleM = inst(pPole, darkMat, pedHeads), pedBoxM = inst(pBox, darkMat, pedHeads);
    const pedRedM = inst(pRed, lampMats(), pedHeads), pedGreenM = inst(pGreen, lampMats(), pedHeads);
    for (const im of [pedPoleM, pedBoxM, pedRedM, pedGreenM]) place(im, pedHeads);
    // 차량 신호등: 기둥 5.6m, 길 위로 뻗은 팔 끝에 가로형 3색등
    const cPole = new THREE.CylinderGeometry(0.1, 0.13, 5.8, 8); cPole.translate(0, 2.9, 0);
    const cArm = new THREE.BoxGeometry(1, 0.12, 0.12); // 길이는 인스턴스마다 늘린다
    const cBox = new THREE.BoxGeometry(1.25, 0.42, 0.3);
    const cLamp = new THREE.PlaneGeometry(0.3, 0.3);
    const carPoleM = inst(cPole, darkMat, carHeads), carArmM = inst(cArm, darkMat, carHeads), carBoxM = inst(cBox, darkMat, carHeads);
    const carLampM = [0, 1, 2].map(() => inst(cLamp, lampMats(), carHeads)); // 빨강, 노랑, 초록 (왼쪽부터)
    place(carPoleM, carHeads);
    carHeads.forEach((h, i) => {
      // 기둥에서 길 안쪽(진행 방향의 왼쪽)으로 팔을 뻗는다
      const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
      const lx = -fz, lz = fx; // 진행 방향(fx, fz)의 왼쪽 = 길 안쪽
      const ax = h.x + lx * h.reach / 2, az = h.z + lz * h.reach / 2;
      m4.position.set(ax, 5.6, az); m4.rotation.set(0, h.yaw + Math.PI, 0); m4.scale.set(h.reach, 1, 1); m4.updateMatrix(); carArmM.setMatrixAt(i, m4.matrix);
      const bx = h.x + lx * h.reach, bz = h.z + lz * h.reach;
      m4.position.set(bx, 5.35, bz); m4.rotation.set(0, h.yaw, 0); m4.scale.set(1, 1, 1); m4.updateMatrix(); carBoxM.setMatrixAt(i, m4.matrix);
      // 등은 다가오는 차 쪽(-진행 방향)을 본다
      [-0.4, 0, 0.4].forEach((o, k) => {
        m4.position.set(bx + lx * o - fx * 0.16, 5.35, bz + lz * o - fz * 0.16); m4.rotation.set(0, h.yaw + Math.PI, 0); m4.updateMatrix();
        carLampM[k].setMatrixAt(i, m4.matrix);
      });
    });
    group.add(pedPoleM, pedBoxM, pedRedM, pedGreenM, carPoleM, carArmM, carBoxM, ...carLampM);
    const LAMP = {
      redOn: new THREE.Color(1.0, 0.16, 0.1), redOff: new THREE.Color(0.16, 0.05, 0.04),
      yellowOn: new THREE.Color(1.0, 0.72, 0.1), yellowOff: new THREE.Color(0.16, 0.12, 0.03),
      greenOn: new THREE.Color(0.15, 1.0, 0.55), greenOff: new THREE.Color(0.03, 0.14, 0.08),
    };
    let lastSignalUpdate = -1;
    function updateSignals(t) {
      if (Math.abs(t - lastSignalUpdate) < 0.2) return;
      lastSignalUpdate = t;
      const blinkOn = Math.floor(t * 2) % 2 === 0;
      pedHeads.forEach((h, i) => {
        const { ped } = signalOf(h.c, t);
        pedRedM.setColorAt(i, ped === "red" ? LAMP.redOn : LAMP.redOff);
        pedGreenM.setColorAt(i, ped === "green" || (ped === "flash" && blinkOn) ? LAMP.greenOn : LAMP.greenOff);
      });
      carHeads.forEach((h, i) => {
        const { car } = signalOf(h.c, t);
        carLampM[0].setColorAt(i, car === "red" ? LAMP.redOn : LAMP.redOff);
        carLampM[1].setColorAt(i, car === "yellow" ? LAMP.yellowOn : LAMP.yellowOff);
        carLampM[2].setColorAt(i, car === "green" ? LAMP.greenOn : LAMP.greenOff);
      });
      for (const im of [pedRedM, pedGreenM, ...carLampM]) if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }

    // 가로수·가로등: 건물 안, 막힌 땅, 출발점·목적지 근처에는 세우지 않는다
    const insideSolid = (x, z) => solids.at(x, z).some((p) => x >= p.minx - 0.8 && x <= p.maxx + 0.8 && z >= p.minz - 0.8 && z <= p.maxz + 0.8 && pointInPoly(x, z, p.pts));
    const cellKind = (x, z) => {
      const c = Math.floor(x / cell), r = Math.floor(z / cell);
      return r < 0 || c < 0 || r >= n || c >= n ? -1 : map.kind[r * n + c];
    };
    const clearOf = (x, z) => (avoid || []).every((a) => Math.hypot(a.x - x, a.z - z) > 4);
    // 횡단보도로 열린 차도 칸도 걷는 칸이라, 차도 노면 위인지 따로 본다 (두 줄 차도에서 옆 차도의 나무 자리가 횡단보도에 떨어지지 않게)
    const onCarway = (x, z) => roadIdx.at(x, z).some((s) => s.car && segDist2(x, z, s.a, s.b) < (s.pad - 4.7) ** 2);
    const okSpot = (x, z) => {
      const k = cellKind(x, z);
      return (k === 2 || k === -1) && !insideSolid(x, z) && clearOf(x, z) && !onCarway(x, z) && !roofPolys.some((p) => pointInPoly(x, z, p));
    };
    const nearExit = (x, z) => exits.some(({ e, t0, t1 }) => {
      const [ax, az] = e.along((t0 + t1) / 2);
      return Math.hypot(ax - x, az - z) < (t1 - t0) / 2 + 3;
    });
    const trees = treeSpots.filter(([x, z]) => x > -250 && z > -250 && x < size + 250 && z < size + 250 && okSpot(x, z) && !nearExit(x, z));
    // 길가 가로수 밑에 철제 보호판 (1.2m, 길 방향으로 돌린다). 심은 나무만
    {
      const kept = new Set(trees.map(([x, z]) => x.toFixed(2) + "," + z.toFixed(2)));
      for (const t of roadTrees) {
        if (!kept.has(t.x.toFixed(2) + "," + t.z.toFixed(2))) continue;
        const ux = Math.sin(t.yaw) * 0.6, uz = Math.cos(t.yaw) * 0.6, vx = -uz, vz = ux;
        upQuad(BGRATE, [[t.x - ux - vx, t.z - uz - vz, 0, 0], [t.x + ux - vx, t.z + uz - vz, 1, 0], [t.x + ux + vx, t.z + uz + vz, 1, 1], [t.x - ux + vx, t.z - uz + vz, 0, 1]], 0.018, ONE);
      }
      T.grate.wrapS = T.grate.wrapT = THREE.ClampToEdgeWrapping; T.grate.needsUpdate = true;
      group.add(toMesh(BGRATE, std(T.grate, { side: THREE.DoubleSide, roughness: 0.6, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
    }
    const obstacles = makeIndex(8);
    for (const [x, z] of pillarSpots) obstacles.add(x - 0.9, z - 0.9, x + 0.9, z + 0.9, { x, z, r: 0.9 });
    const rampIdx = makeIndex(12);
    for (const s of rampSegs) rampIdx.add(Math.min(s.a[0], s.b[0]) - s.hw, Math.min(s.a[1], s.b[1]) - s.hw, Math.max(s.a[0], s.b[0]) + s.hw, Math.max(s.a[1], s.b[1]) + s.hw, s);
    // 가로수: 모델(js/trees.js)이 있으면 EZ-Tree 나무, 없으면 예전 다면체 나무
    const treeLod = typeof TREES !== "undefined" && TREES.ready() ? TREES.build(group, trees, hash) : null;
    if (treeLod) for (const [x, z] of trees) obstacles.add(x - 0.3, z - 0.3, x + 0.3, z + 0.3, { x, z, r: 0.3 });
    const trunkGeo = new THREE.CylinderGeometry(0.13, 0.2, 3, 6); trunkGeo.translate(0, 1.5, 0);
    const crownGeo = new THREE.IcosahedronGeometry(2, 0); crownGeo.translate(0, 4.4, 0);
    const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: lin("#5b4a3c"), roughness: 1 }), Math.max(1, trees.length));
    const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), Math.max(1, trees.length));
    // 가을 은행나무처럼 일부는 노랗게 칠한다
    const greens = ["#5f8a45", "#6f9a4c", "#557d3f", "#7ea152", "#c8b03c", "#d9be45", "#8fa648"].map(lin);
    trunk.count = crown.count = treeLod ? 0 : trees.length;
    if (!treeLod) trees.forEach(([x, z], i) => {
      const s = 0.8 + hash(i * 1.7) * 0.5;
      dummy.position.set(x, 0, z); dummy.rotation.set(0, hash(i) * 6.28, 0); dummy.scale.set(s, s * (0.9 + hash(i * 2.3) * 0.4), s);
      dummy.updateMatrix();
      trunk.setMatrixAt(i, dummy.matrix); crown.setMatrixAt(i, dummy.matrix);
      crown.setColorAt(i, greens[Math.floor(hash(i * 4.1) * greens.length)]);
      obstacles.add(x - 0.3, z - 0.3, x + 0.3, z + 0.3, { x, z, r: 0.3 });
    });
    trunk.castShadow = crown.castShadow = true; crown.receiveShadow = true;
    group.add(trunk, crown);

    const lamps = lampSpots.filter(({ p }) => okSpot(p[0], p[1]));
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 8, 6); poleGeo.translate(0, 4, 0);
    const armGeo = new THREE.BoxGeometry(0.12, 0.12, 2.2); armGeo.translate(0, 7.9, 1.0);
    const headGeo = new THREE.BoxGeometry(0.35, 0.18, 0.8); headGeo.translate(0, 7.8, 2.1);
    const metal = new THREE.MeshStandardMaterial({ color: lin("#5c6066"), roughness: 0.6, metalness: 0.3 });
    const lampN = Math.max(1, lamps.length);
    const pole = new THREE.InstancedMesh(poleGeo, metal, lampN);
    const arm = new THREE.InstancedMesh(armGeo, metal, lampN);
    const head = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: lin("#e9e2cc"), roughness: 0.5 }), lampN);
    pole.count = arm.count = head.count = lamps.length;
    lamps.forEach(({ p, yaw }, i) => {
      dummy.position.set(p[0], 0, p[1]); dummy.rotation.set(0, yaw, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      pole.setMatrixAt(i, dummy.matrix); arm.setMatrixAt(i, dummy.matrix); head.setMatrixAt(i, dummy.matrix);
      obstacles.add(p[0] - 0.2, p[1] - 0.2, p[0] + 0.2, p[1] + 0.2, { x: p[0], z: p[1], r: 0.2 });
    });
    pole.castShadow = arm.castShadow = true;
    group.add(pole, arm, head);

    // 거리 소품 (불러왔을 때만). 놓은 소품은 충돌 판정에 넣는다
    const props = typeof STREETPROPS !== "undefined" && STREETPROPS.ready() ? STREETPROPS.place({
      group, buildings: bldList, roads, crossings, conePos, kindAt, onCarway, clearOf, nearExit, hash, size, quality: CONFIG.QUALITY,
      addObstacle: (x, z, r) => obstacles.add(x - r, z - r, x + r, z + r, { x, z, r }),
    }) : null;
    if (props && props.coneModel) coneMesh.count = baseMesh.count = 0; // 코드로 그린 라바콘 대신 모델
    scene.add(group);

    // 원(플레이어)이 건물 벽이나 나무 기둥에 닿는지 검사한다
    function segDist2(px, pz, a, b) {
      const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L2)) : 0;
      const qx = a[0] + dx * t - px, qz = a[1] + dz * t - pz;
      return qx * qx + qz * qz;
    }
    function hits(x, z, radius) {
      for (const p of solids.at(x, z)) {
        if (x < p.minx - radius || x > p.maxx + radius || z < p.minz - radius || z > p.maxz + radius) continue;
        if (pointInPoly(x, z, p.pts)) return true;
        for (let i = 0; i < p.pts.length; i++) if (segDist2(x, z, p.pts[i], p.pts[(i + 1) % p.pts.length]) < radius * radius) return true;
      }
      for (const o of obstacles.at(x, z)) if (Math.hypot(o.x - x, o.z - z) < o.r + radius) return true;
      for (const s of rampIdx.at(x, z)) if (segDist2(x, z, s.a, s.b) < (s.hw + radius) ** 2) return true;
      return false;
    }

    // 매 프레임: 경고등 깜빡임, 신호, 가까운 나무를 입체로 (나무를 바꾸면 그림자 지도도 다시 그린다)
    function tick(now, cam) {
      lampMat.emissiveIntensity = Math.sin(now * 0.004) > 0 ? 1.8 : 0.15;
      updateSignals(now / 1000);
      if (treeLod && cam && treeLod.update(cam.x, cam.z)) renderer.shadowMap.needsUpdate = true;
      if (lmTick && cam) lmTick(cam);
    }
    // 가장자리 가림막 앞인지 (안내 문구를 띄울 때 쓴다)
    const nearEdge = (x, z) => x < EDGE_BAND + 1.2 || z < EDGE_BAND + 1.2 || x > size - EDGE_BAND - 1.2 || z > size - EDGE_BAND - 1.2;

    // 점검용: 걷는 칸과 막힌 차도 칸이 맞닿은 변 가운데, 2.5m 안에 울타리가 있는 변의 비율 (횡단보도 자리는 뺀다)
    function fenceStats() {
      const idx = new Map(), G = 10, at = (x, z) => Math.floor(x / G) + "," + Math.floor(z / G);
      for (const sg of fenceSegs) for (let t = 0; t <= 1; t += 0.25) { const x = sg[0][0] + (sg[1][0] - sg[0][0]) * t, z = sg[0][1] + (sg[1][1] - sg[0][1]) * t, k = at(x, z); (idx.get(k) || idx.set(k, []).get(k)).push(sg); }
      const near = (x, z) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const sg of idx.get((Math.floor(x / G) + a) + "," + (Math.floor(z / G) + b)) || []) if (segDist2(x, z, sg[0], sg[1]) < 6.25) return true; return false; };
      let edges = 0, covered = 0; const gaps = [];
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if (map.kind[r * n + c] !== 2) continue;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= n || cc >= n || map.kind[rr * n + cc] !== 3) continue;
          const x = (c + 0.5 + dc / 2) * cell, z = (r + 0.5 + dr / 2) * cell;
          if (crossings.some((q) => Math.hypot(q.x - x, q.z - z) < q.w / 2 + 6)) continue;
          edges++;
          if (near(x, z)) covered++; else if (gaps.length < 400) gaps.push([Math.round(x), Math.round(z)]);
        }
      }
      return { list: () => fenceSegs.map((q) => [q[0][0], q[0][1], q[1][0], q[1][1], q.rd || 0]), segs: fenceSegs.length, filled: fenceFill, edges, covered, pct: edges ? +(covered / edges * 100).toFixed(1) : 100, gaps };
    }
    return { group, hits, tick, nearEdge, fenceStats, edgeBand: EDGE_BAND, roads, crossings, signalOf, kindAt, deckY, stats: { buildings: polys.length, villas: BVILLA.p.length / 18, vsigns: vsigns.length, roof: roofStats, trees: trees.length, treeModels: !!treeLod, exits: exits.length, props: props && props.counts }, treeStats: () => (treeLod ? treeLod.stats() : null),
      exits: exits.map(({ e, t0, t1 }) => { const [x, z] = e.along((t0 + t1) / 2); return { x, z, inward: e.inward, width: t1 - t0 }; }) };
  }

  // ---------- 하늘, 빛, 안개 ----------
  function atmosphere(scene, renderer, camera) {
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    const shadowSize = QUALITY_PRESETS[CONFIG.QUALITY].shadowMap; // 품질 낮음은 그림자 없음
    renderer.shadowMap.enabled = shadowSize > 0;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // 그림자를 드리우는 것은 건물·나무·전봇대처럼 움직이지 않는 것뿐이라, 그림자 지도는 해가 따라 움직일 때만 다시 그린다.
    // 매 프레임 다시 그리면 장면 전체(삼각형 약 270만 개)를 한 번 더 그려서 fps가 절반 가까이 떨어졌다 (2026-10-19 측정: 26 → 41)
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;

    const HORIZON = 0xdfe7ec;
    scene.fog = new THREE.Fog(lin(HORIZON), CONFIG.FOG_NEAR, CONFIG.FOG_FAR);
    const skyR = camera.far * 0.9;
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(skyR, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
        uniforms: { top: { value: lin(0x5f8fc9) }, horizon: { value: lin(HORIZON) }, bottom: { value: lin(0xc5ced4) } },
        vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: "uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;\n" +
          "void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(min(h * 1.6, 1.0), 0.7)) : mix(horizon, bottom, min(-h * 4.0, 1.0));\n" +
          "gl_FragColor = vec4(c, 1.0);\n#include <tonemapping_fragment>\n#include <encodings_fragment>\n}",
      })
    );
    sky.renderOrder = -10;
    scene.add(sky);

    scene.add(new THREE.HemisphereLight(lin(0xd6e4f2), lin(0x7d7264), 0.85));
    const SUN_DIR = new THREE.Vector3(-0.55, 0.72, 0.42).normalize(); // 남서쪽 오후 햇빛
    const sun = new THREE.DirectionalLight(lin(0xfff0d6), 2.3);
    sun.castShadow = shadowSize > 0;
    sun.shadow.mapSize.set(shadowSize || 1024, shadowSize || 1024);
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.4;
    const sc = sun.shadow.camera;
    sc.near = 1; sc.far = 600; sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80;
    scene.add(sun, sun.target);

    // 그림자는 플레이어 주변만 촘촘하게 그린다. 플레이어가 8m 넘게 움직여 해가 따라 옮겨질 때만 그림자 지도를 다시 그린다
    const STEP = 8;
    let sx = NaN, sz = NaN;
    return function update() {
      sky.position.copy(camera.position);
      const tx = Math.round(camera.position.x / STEP) * STEP, tz = Math.round(camera.position.z / STEP) * STEP;
      if (tx !== sx || tz !== sz) {
        sx = tx; sz = tz;
        sun.target.position.set(tx, 0, tz);
        sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 300);
        sun.target.updateMatrixWorld();
        renderer.shadowMap.needsUpdate = true;
      }
    };
  }

  return { build, atmosphere, load };
})();
