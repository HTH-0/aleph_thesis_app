# 검증 스크립트

외부 패키지 없이 Node.js(22 이상, 내장 `fetch`·`WebSocket` 사용)와 Chrome만으로 돌아간다.
스크린샷과 브라우저 프로필은 `tools/check/out/`에 저장되고, 이 폴더는 저장소에 올라가지 않는다.
Chrome을 못 찾으면 `CHROME_PATH` 환경 변수로 위치를 알려 준다.

## 브라우저 없이

| 명령 | 하는 일 |
|---|---|
| `node tools/check/routes.mjs` | 7개 지도에서 소리 3개와 두 판 경로(시드 10개)가 만들어지는지 검사한다. 실패가 있으면 종료 코드 1 |
| `node tools/check/grid.mjs banwoldang` | 이동 판정 격자를 PNG로 그린다. 큰길로 지도가 끊겼는지 볼 때 쓴다 |
| `node tools/check/crosswalk_xcheck.mjs` | 공공 횡단보도와 규칙 교차로의 일치 비율 표를 다시 만든다 (먼저 `node tools/fetch_public.mjs`) |
| `node tools/check/shp_info.mjs <파일.shp>` | 새 공공데이터 Shapefile의 열 이름과 첫 값, 위경도 변환 결과를 보여 준다 |

## 브라우저로 (먼저 다른 터미널에서 `node tools/check/serve.mjs`)

| 명령 | 하는 일 |
|---|---|
| `node tools/check/play.mjs` | 지역마다 테스트 모드(`?test=1`)로 두 판을 진행해서 결과 화면까지 가는지 검사한다. 판마다 fps, 행인·차량 수를 찍는다 |
| `node tools/check/play.mjs seomun,banwoldang` | 고른 지역만 검사한다 |
| `node tools/check/views.mjs dongseongro` | 횡단보도 앞, 큰길 보도, 지도 끝 가림막 화면을 찍고, 큰 차도로 걸어 들어가기와 가림막 부딪히기를 확인한다 |

헤드리스 Chrome은 GPU 없이 그리므로 fps가 10 안팎으로 낮게 나온다. 실제 성능은 일반 브라우저에서 `?test=1`로 열어 왼쪽 위 숫자를 본다.
테스트 모드에서만 `window.__play`(출구 목록, 횡단보도 목록, 순간 이동, 행인·차량 집계)가 생긴다.
