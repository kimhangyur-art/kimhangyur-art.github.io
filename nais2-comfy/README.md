# NAIS2 Comfy

NAIS2 화면 그대로, 그림은 내 컴퓨터의 **ComfyUI**로 그립니다.

[NAIS2](https://github.com/sunanakgo/NAIS2) (NovelAI Image Studio 2.7.4)를 고쳐 만든 프로그램입니다. 메인 생성, 씬 모드, 기록·라이브러리, 프롬프트 편집(조각·자동완성·프리셋·캐릭터 프롬프트)은 NAIS2와 같고, NovelAI 대신 로컬 ComfyUI(기본 `http://127.0.0.1:8188`)에 작업을 보냅니다.

## 처음 쓰는 분

1. **ComfyUI를 켭니다.** (포터블 판이면 `run_nvidia_gpu.bat`)
   쓸 체크포인트(`.safetensors`)는 `ComfyUI/models/checkpoints`, 로라는 `ComfyUI/models/loras` 에 넣어 둡니다.
2. **`release/NAIS2-Comfy.exe`를 더블클릭합니다.** (GitHub에서 파일을 연 뒤 오른쪽 위 다운로드 버튼)
   - "Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행**. (서명하지 않은 프로그램이라 처음 한 번 뜹니다)
   - 창을 닫으면 프로그램도 끝납니다. 프롬프트·설정·씬은 자동으로 남습니다.
3. 왼쪽 위 상태 표시가 **초록색 "ComfyUI 연결됨"** 인지 봅니다.
   빨간색이면 ComfyUI를 켜거나, **설정 → ComfyUI** 에서 주소를 맞추고 [연결 확인]을 누릅니다.
4. 프롬프트 아래 **톱니바퀴(생성 설정)** 에서 체크포인트를 고르고 **[권장값 적용]** 을 누릅니다.
   (스텝·CFG·샘플러·스케줄러·CLIP skip이 그 모델에 맞는 값으로 바뀝니다)
5. 프롬프트를 쓰고 **[생성]**. 그림은 `사진/NAIS_Output` 에 저장되고 오른쪽 기록에 뜹니다.

필요한 것: Windows 10/11 (Edge가 기본으로 들어 있음), ComfyUI. ComfyUI에 따로 설정(`--enable-cors-header` 등)을 할 필요는 없습니다. 이 프로그램이 ComfyUI 요청을 직접 중계합니다.
그리는 중간 그림(실시간 미리보기)까지 보려면 ComfyUI를 `--preview-method auto` 옵션으로 켭니다.

## NAIS2와 다른 점

| NAIS2 (NovelAI) | NAIS2 Comfy |
|---|---|
| 모델 선택 | ComfyUI 체크포인트 선택 (ComfyUI에서 목록을 받아 옴) + 모델 계열(자동 짐작) |
| — | **LoRA 목록** (켜기/끄기, 모델·CLIP 세기), **CLIP skip** |
| 샘플러·스케줄러 (NAI 이름) | ComfyUI 이름 (예전 프리셋의 `k_euler_ancestral` 등은 자동으로 바꿈) |
| 품질 태그 추가 / UC 프리셋 (NAI가 서버에서 붙임) | 체크포인트 계열 권장 품질 태그·부정 프롬프트를 이 프로그램이 붙임 (설정에서 직접 지정 가능) |
| `{태그}` `[태그]` `1.2::태그::` | 그대로 써도 됨. 보낼 때 ComfyUI 문법 `(태그:1.05)` 로 바뀌고, 글자 괄호 `hatsune miku (vocaloid)` 는 자동으로 `\(` `\)` 처리 |
| NAI 업스케일 | **고화질** 두 가지: ① 생성 설정의 *고화질(hires fix)* 을 켜고 그리기 ② 아무 그림이나 **[고화질로 다시 그리기]** — 그림 자체에서 시작하므로 **시드를 고정하거나 알 필요가 없습니다** |
| — | **변형 모드**: 헤어스타일·머리색·눈색 같은 요소의 후보를 적으면 후보마다 차례로 그려 비교 표로 보여 줌 |
| 캐릭터 프롬프트 (위치 지정) | 메인 프롬프트 뒤에 이어 붙임 (위치 지정 없음) |

빠진 기능: 바이브 트랜스퍼, 캐릭터 레퍼런스, 인페인트, I2I, 스마트 툴, 마켓, 내장 웹뷰, Gemini 프롬프트 생성, 자동 업데이트, NAI 로그인·Anlas.

### 기존 NAIS2 자료 옮기기

- **씬 프리셋**: NAIS2 씬 모드의 JSON 내보내기 파일을 씬 모드에서 그대로 가져오기.
- **조각(와일드카드)**: NAIS2 조각 창의 "전체 내보내기(JSON)" 파일을 그대로 가져오기.
- **전체 백업**: NAIS2 설정 → 백업 내보내기 → 이 프로그램 설정 → 백업 가져오기. (NAI 전용 값은 알아서 바뀌거나 무시됩니다)

### 저장 위치 (NAIS2와 같은 구조)

- 메인 생성: `사진/NAIS_Output/NAIS_<시각>.png` (설정 → 저장에서 바꿈)
- 고화질로 다시 그린 그림: 원본과 같은 폴더의 `NAIS_UPSCALE_<시각>.png` (씬 그림은 그 씬 폴더)
- 씬: `사진/NAIS_Scene/<프리셋>/<씬>/NAIS_SCENE_<시각>.png`
- 변형 모드: `사진/NAIS_Variation/<묶음>/NAIS_VAR_<변형>_<시각>.png`

그림 파일에는 생성 정보(프롬프트, 체크포인트, 로라, 시드…)가 들어 있어서, 그림을 끌어다 놓거나 [다시 생성]하면 같은 설정이 돌아옵니다. ComfyUI 작업 정보(`prompt`)도 그대로 들어 있어 ComfyUI 창에 끌어다 놓아도 열립니다.

## 개발자용

```bash
cd nais2-comfy
npm install
npm test            # vitest
npm run build       # dist/
npm run build:exe   # release/NAIS2-Comfy.exe (Go 1.24 이상)
```

구조:

- `launcher/` — exe(Go). 화면(dist/)을 넣어 두고 `127.0.0.1:47900`(고정)에서 띄운 뒤 Edge를 앱 창으로 엽니다(전용 프로필).
  - `/comfy/*` → ComfyUI로 중계 (HTTP·WebSocket, Origin을 지워 ComfyUI의 출처 검사를 통과)
  - `/__api/*` → 파일 읽기·쓰기·목록·삭제, 폴더 열기, Windows 파일 고르기 창(PowerShell), 간단한 저장소
  - 화면에 심은 토큰이 있어야 `/__api`·`/comfy`를 쓸 수 있고, 다른 출처(Origin)·다른 Host 요청은 막습니다.
  - 화면이 10초마다 신호를 보내고, 창을 닫으면 몇 초 뒤 스스로 끝납니다.
- `src/shims/` — `@tauri-apps/*` 대체 모듈 (vite·tsconfig 별칭). NAIS2 원래 코드의 파일·대화상자 호출이 그대로 동작합니다.
- `src/services/comfy/` — ComfyUI 클라이언트(작업 등록·WebSocket·결과·중단), 워크플로우 생성(기본 노드만), 체크포인트 계열 권장값, NAI→ComfyUI 프롬프트 문법 변환.
- `src/services/comfyui-api.ts` — 생성 요청 → ComfyUI 작업 → 결과 PNG에 NAIS2 메타데이터(`Comment`, `Source`, `nais2-params`) 넣기.
- `src/lib/comfy-params.ts` — 화면 상태로 생성 요청 만들기, 메타데이터로 다시 생성, 고화질로 다시 그리기.
- `src/lib/output-save.ts` — 저장 위치·파일 이름 규칙, 기록 패널 알림.

개발 서버로 볼 때: `NC_TOKEN=dev NC_NO_BROWSER=1 go run ./launcher` 를 띄우고 `VITE_NC_TOKEN=dev npm run dev`.

## 라이선스

GPL-3.0. 원본 NAIS2 © sunanakgo (GPL-3.0, `LICENSE`).
이 폴더는 NAIS2 2.7.4(커밋 `bf489ff`)를 고친 것이며, 바뀐 내용은 이 저장소의 커밋 기록에 있습니다.
