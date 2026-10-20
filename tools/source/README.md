# 지도 생성 입력

`tools/build_maps.mjs`가 지역마다 읽는 입력이다. 원본 전체(브이월드 건물 SHP는 2GB가 넘는다)가 아니라 지역 범위(지도 840m + 배경 350m)만 잘라 담았다.
덕분에 어느 PC에서든 `git pull` 후 `node tools/build_maps.mjs`로 같은 지도를 다시 만들 수 있다.

| 파일 | 내용 | 출처와 이용 조건 |
|---|---|---|
| `<지역>/osm.json` | Overpass로 받은 OSM 원본(도로, 건물, 녹지, 소리 장소 등) | © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright) |
| `<지역>/buildings.json` | GIS건물통합정보에서 지역 범위의 건물만 골라, 게임 좌표(m)로 바꾼 도형과 용도·구조·사용승인일·높이·건물명·동명·층수 | 국토교통부 GIS건물통합정보 (브이월드, 2026-10-09 기준), 저작자표시(CC BY) |
| `<지역>/crosswalks.json` | 공공 횡단보도 도형(게임 좌표) | 서울: 서울시 교통안전시설물 횡단보도 정보(OA-15554, 공공누리 제1유형) / 대구: 대구광역시_횡단보도(공공데이터포털 15029067) |
| `<지역>/sidewalks.json` | 서울 도로 이름별 보도 폭(m) 표 (서울 지역만) | 서울시 보도 통계자료(OA-22240, 공공누리 제1유형) |

게임 좌표: x는 동쪽, z는 남쪽(m), 원점은 지도 북서쪽 모서리. 지역 중심은 `tools/build_maps.mjs`의 `REGIONS`에 있다.

## 다시 만들기

- 평소: `node tools/build_maps.mjs` (이 폴더만 읽는다. 원본이 없어도 된다)
- 원본에서 다시 잘라 내기: `node tools/build_maps.mjs --refresh-sources` (`참고자료/공공데이터/`에 횡단보도·보도 통계·건물 원본이 있어야 한다. 받는 방법은 `tools/fetch_public.mjs`와 저장소 README)
- OSM을 새로 받기: `node tools/build_maps.mjs --fresh` (Overpass 서버에서 받아 `osm.json`을 바꾼다. 받은 시점이 달라 지도가 조금 달라질 수 있다)

이 폴더는 `.vercelignore`로 배포에서 빠진다.
