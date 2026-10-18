// 게임 전역 설정값. 숫자만 바꾸면 난이도와 소리 느낌을 조절할 수 있다.
const CONFIG = {
  QUALITY: "medium",       // 그래픽 품질 low·medium·high (첫 화면에서 고른다, js/main.js)

  // 이동과 시야
  EYE_HEIGHT: 1.6,
  PLAYER_RADIUS: 0.6,
  MOVE_SPEED: 6,          // m/s (Shift를 누르면 RUN_SPEED)
  RUN_SPEED: 9,
  LOOK_SENSITIVITY: 0.0022,
  FOG_NEAR: 60,
  FOG_FAR: 320,           // 이 거리(m)부터 안개에 완전히 가려진다. 줄이면 길찾기가 어려워진다
  GOAL_RADIUS: 4,
  ROUND_TIMEOUT_SEC: 300,

  // 출발점과 목적지 사이 최단경로 길이(m)
  ROUTE_METERS: 440,
  ROUTE_TOLERANCE: 0.1,
  GOAL_MIN_DIST_FROM_LANDMARK: 40, // 목적지에는 소리를 두지 않는다 (논문 2.1)

  // 소리 (논문 2.1: linear 감쇠, 일정 거리 밖에서는 완전히 무음)
  SOUND_REF_DISTANCE: 15,
  SOUND_MAX_DISTANCE: 600,   // 지도 한 변(840m)의 약 70%. 논문처럼 맵 구석에서는 들리지 않는 소리가 생긴다
  SOUND_ROLLOFF: 1,
  SOUND_LOWPASS_HZ: 5000,    // 고음을 깎아 귀가 아프지 않게 한다
  PROXIMITY_FAR: 40,         // 가까이 가면 소리가 떨린다 (논문 2.1)
  PROXIMITY_NEAR: 10,
  PROXIMITY_DEPTH: 0.35,
  PROXIMITY_RATE: 5.5,
  LANDMARK_MARGIN: 200,      // 지도 밖이라도 이 거리 안의 장소는 소리로 쓴다

  // 거리: 큰 차도와 신호
  WIDE_ROAD: 10,             // 이 폭(m) 이상인 차도는 걸어서 들어갈 수 없다 (tools/build_maps.mjs의 WIDE_ROAD와 같다)
  SIGNAL_GREEN: 30,          // 한 방향 차량 초록불(초)
  SIGNAL_YELLOW: 3,          // 노란불(초). 이 동안은 모든 방향 보행 신호가 빨간불이다
  PED_FLASH: 5,              // 보행 초록불이 끝나기 전 깜빡이는 시간(초)

  // 행인과 차량 (플레이어 주변에서만 움직인다. 소리는 내지 않는다)
  NPC_RADIUS: 150,           // 이 거리(m) 안에서만 행인·차량을 둔다
  PEDESTRIANS: 120,          // 행인 모델(js/people.js)을 못 불러왔을 때의 상자 사람 수
  PEOPLE_MODELS: 60,         // 행인 모델을 쓸 때의 사람 수 (한 명이 삼각형 약 7천 개라 상자 사람보다 적게 둔다)
  CARS: 35,
  PED_SPEED: 1.3,            // m/s
  CAR_SPEED: 10,             // 큰길 m/s (약 36km/h)
  CAR_SPEED_ALLEY: 4,        // 골목 m/s
};

// 장소 종류별 소리. group이 서로 다른 소리를 우선 골라 음색이 겹치지 않게 한다.
// mode: "loop"는 loopStart~loopEnd(초)를 계속 반복, "pulse"는 interval(ms)마다 clip(초)만큼 재생한다.
// gain은 파일마다 평균 음량(RMS)을 재서 약 0.06~0.08로 맞춘 값이다 (2026-10-15 측정).
// lowpass(Hz)는 전체 필터(SOUND_LOWPASS_HZ) 외에 그 소리만 고음을 더 깎을 때 쓴다.
const SOUND_TYPES = {
  // 17.5초, RMS 0.144. 앞 2초는 점점 커지는 구간이라 반복에서 뺀다
  stadium:      { label: "경기장", sound: "함성", file: "sounds/stadium.mp3", group: "crowd", mode: "loop", loopStart: 2.5, loopEnd: 17, gain: 0.5, color: "#c0504d" },
  // 9.6초 동안 계속 울리는 착암기라서 1.2초만 끊어 "따다다" 하고 멈추게 한다
  construction: { label: "공사장", sound: "착암기", file: "sounds/construction.mp3", group: "hit", mode: "pulse", interval: 3100, clip: 1.2, gain: 0.4, lowpass: 3500, color: "#d08a2e" },
  // 4.8초, 한 번 울리고 잦아드는 종
  church:       { label: "교회·성당", sound: "종소리", file: "sounds/church.mp3", group: "bell", mode: "pulse", interval: 4700, clip: 4.5, gain: 1.4, color: "#4f6fa8" },
  // 8.1초, 길게 울리는 낮은 종
  temple:       { label: "절", sound: "범종", file: "sounds/temple.mp3", group: "bell", mode: "pulse", interval: 7300, clip: 7, gain: 0.8, color: "#7d5ba6" },
  // 18.5초, RMS 0.026으로 작고 "쉬" 하는 고음이 많아서 키우면서 고음을 많이 깎는다
  fountain:     { label: "분수대", sound: "물소리", file: "sounds/fountain.mp3", group: "water", mode: "loop", loopStart: 0.5, loopEnd: 18, gain: 2.6, lowpass: 2200, color: "#3b9aa8" },
  // 11.4초, 아이들 고함이 순간적으로 커서(최대 0.99) 고음을 깎는다
  playground:   { label: "놀이터", sound: "아이들 소리", file: "sounds/playground.mp3", group: "crowd", mode: "loop", loopStart: 0.5, loopEnd: 11, gain: 0.8, lowpass: 3000, color: "#5a9a4a" },
  // 시장 소리 파일이 아직 없어 합성음으로 재생한다. 파일을 넣으면 음량과 반복 구간을 다시 맞춘다
  market:       { label: "시장", sound: "시장 소리", file: "sounds/market.mp3", group: "market", mode: "loop", gain: 0.8, lowpass: 4000, color: "#b5651d" },
};
// 같은 group 안에서 먼저 고를 순서
const SOUND_PRIORITY = ["stadium", "construction", "church", "temple", "fountain", "market", "playground"];

// 논문 3.1 표: 소리 3개 조건의 시간비 (자기 소리 0개 시행 대비)
const PAPER = {
  title: "미로형 3D 공간에서 고정 청각 랜드마크의 개수가 길찾기에 미치는 영향",
  ratios3: [
    { id: "P1", ratio: 2.75 },
    { id: "P2", ratio: 0.66 },
    { id: "P3", ratio: 0.36 },
    { id: "P4", ratio: 0.44 },
    { id: "P5", ratio: 0.80 },
  ],
};
