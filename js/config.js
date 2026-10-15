// 게임 전역 설정값. 숫자만 바꾸면 난이도와 소리 느낌을 조절할 수 있다.
const CONFIG = {
  // 이동과 시야
  EYE_HEIGHT: 1.6,
  PLAYER_RADIUS: 0.6,
  MOVE_SPEED: 6,          // m/s (Shift를 누르면 RUN_SPEED)
  RUN_SPEED: 9,
  LOOK_SENSITIVITY: 0.0022,
  FOG_NEAR: 4,
  FOG_FAR: 30,            // 논문처럼 가까운 곳만 보이게 한다 (격자 약 7칸)
  GOAL_RADIUS: 4,
  ROUND_TIMEOUT_SEC: 300,

  // 출발점과 목적지 사이 최단경로 길이(격자 칸 수). 칸 하나는 4m.
  ROUTE_CELLS: 110,
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
};

// 장소 종류별 소리. group이 서로 다른 소리를 우선 골라 음색이 겹치지 않게 한다.
// mode: "loop"는 계속 재생, "pulse"는 interval(ms)마다 clip(초)만큼 재생한다.
const SOUND_TYPES = {
  stadium:      { label: "경기장", sound: "함성", file: "sounds/stadium.mp3", group: "crowd", mode: "loop", gain: 0.45, color: "#c0504d" },
  construction: { label: "공사장", sound: "착암기", file: "sounds/construction.mp3", group: "hit", mode: "pulse", interval: 3100, clip: 2.2, gain: 0.6, color: "#d08a2e" },
  church:       { label: "교회·성당", sound: "종소리", file: "sounds/church.mp3", group: "bell", mode: "pulse", interval: 4700, clip: 4, gain: 0.8, color: "#4f6fa8" },
  temple:       { label: "절", sound: "범종", file: "sounds/temple.mp3", group: "bell", mode: "pulse", interval: 6300, clip: 6, gain: 1.0, color: "#7d5ba6" },
  fountain:     { label: "분수대", sound: "물소리", file: "sounds/fountain.mp3", group: "water", mode: "loop", gain: 0.55, color: "#3b9aa8" },
  playground:   { label: "놀이터", sound: "아이들 소리", file: "sounds/playground.mp3", group: "crowd", mode: "loop", gain: 0.45, color: "#5a9a4a" },
};
// 같은 group 안에서 먼저 고를 순서
const SOUND_PRIORITY = ["stadium", "construction", "church", "temple", "fountain", "playground"];

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
