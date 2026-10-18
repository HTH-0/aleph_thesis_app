# 검증 스크립트

외부 패키지 없이 Node.js(22 이상, 내장 `fetch`·`WebSocket` 사용)와 Chrome만으로 돌아간다.
스크린샷과 브라우저 프로필은 `tools/check/out/`에 저장되고, 이 폴더는 저장소에 올라가지 않는다.
Chrome을 못 찾으면 `CHROME_PATH` 환경 변수로 위치를 알려 준다.

## 브라우저 없이

| 명령 | 하는 일 |
|---|---|
| `node tools/check/routes.mjs` | 지역 목록(`data/regions.json`)의 모든 지도에서 소리 3개와 두 판 경로(시드 10개)가 만들어지는지 검사한다. 실패가 있으면 종료 코드 1 |
| `node tools/check/grid.mjs banwoldang` | 이동 판정 격자를 PNG로 그린다. 큰길로 지도가 끊겼는지 볼 때 쓴다 |
| `node tools/check/islands.mjs` | 차도·보도 자리인데 걷는 영역에서 떨어져 나간 길(막힌 땅·화단이 된 곳)의 비율과 위치를 지역마다 보여 준다. 지도 끝 20m 안 덩어리는 "가장자리"로 따로 센다 |
| `node tools/check/crosswalk_xcheck.mjs` | 공공 횡단보도와 규칙 교차로의 일치 비율 표를 다시 만든다 (먼저 `node tools/fetch_public.mjs`) |
| `node tools/check/shp_info.mjs <파일.shp>` | 새 공공데이터 Shapefile의 열 이름과 첫 값, 위경도 변환 결과를 보여 준다 |
| `node tools/check/sidewalk.mjs` | 차도마다 "양옆에 인도가 있다"는 가정을 데이터(큰길, 서울 보도 통계, 공공 횡단보도, 건물 간격)로 나누고, 게임 경로가 자주 지나는 확인 지점을 지역당 10곳 고른다 → `out/sidewalk_points.json` |

## 지도 검수 화면 (사람이 판정)

`node tools/check/review.mjs` 후 `http://127.0.0.1:8765/review`. 우리 게임 지도와 카카오 스카이뷰·로드뷰를 나란히 띄우고, 확인 지점마다 실제 인도(양쪽/한쪽/없음)와 도로 폭(노란 선과 실제 연석 비교)을 고른다. 1~4, Q~R 키로 고르고 Enter로 저장한다.

- 카카오 JavaScript 키를 저장소 맨 위 `.env`에 `KAKAO_JS_KEY=...`로 넣는다(커밋하지 않는다). 카카오 개발자 콘솔에서 `http://127.0.0.1:8765`, `http://localhost:8765`를 JavaScript SDK 도메인으로 등록하고 카카오맵 사용 설정을 켠다.
- 판정은 `out/review_checks.json`에 쌓인다. 카카오 화면(로드뷰 이미지)은 저장하지 않는다. 카카오는 공식 API로 실시간 표시만 허용하고 이미지 추출·저장과 자동 분석은 막는다.
- 같은 포트에서 게임(`/`)도 열린다. `serve.mjs`와 함께 켜지 않는다.

## 브라우저로 (먼저 다른 터미널에서 `node tools/check/serve.mjs`)

| 명령 | 하는 일 |
|---|---|
| `node tools/check/play.mjs` | 지역마다 테스트 모드(`?test=1`)로 두 판을 진행해서 결과 화면까지 가는지 검사한다. 판마다 fps, 행인·차량 수를 찍는다 |
| `node tools/check/play.mjs seomun,banwoldang` | 고른 지역만 검사한다 |
| `node tools/check/traffic.mjs` | 지역마다 출발점과 횡단보도 세 곳에서 차를 지켜보고, 차가 차도 노면 밖에 있던 비율, 교차로 통과·건너뜀, 막다른 길에서 사라진 횟수, 그리기 호출·삼각형 수를 찍는다 |
| `node tools/check/views.mjs seomun` | 횡단보도 앞, 큰길 보도, 지도 끝 가림막 화면을 찍고, 큰 차도로 걸어 들어가기와 가림막 부딪히기를 확인한다 |

헤드리스 Chrome은 기본으로 GPU 없이 그리므로 fps가 10 안팎으로 낮게 나온다. `CHECK_GPU=1`을 앞에 붙이면 이 컴퓨터의 GPU로 그린다(맥북에서 60fps에 막히므로 무게는 HUD의 그리기 호출·삼각형 수로 비교한다). 실제 성능은 일반 브라우저에서 `?test=1`로 열어 왼쪽 위 숫자를 본다.
테스트 모드에서만 `window.__play`(출구 목록, 횡단보도 목록, 순간 이동, 행인·차량 집계)가 생긴다.
