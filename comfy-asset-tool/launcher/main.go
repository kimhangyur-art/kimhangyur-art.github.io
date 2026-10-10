// 캐릭터 에셋 공방 실행 파일.
//
// 화면 파일(web/)을 exe 안에 넣어 두고, 이 컴퓨터 안에서만 열리는 주소(127.0.0.1)로 띄운 뒤
// Edge(없으면 Chrome, 그것도 없으면 기본 브라우저)를 주소창 없는 앱 창으로 연다.
// 창을 닫으면 화면이 보내던 신호가 끊겨 프로그램도 스스로 끝난다.
//
// 빌드: npm run build:exe (화면을 빌드해 web/에 복사한 뒤 Windows용 exe를 만든다)
package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

//go:embed all:web
var webFiles embed.FS

const appID = "comfy-asset-tool"

// 주소(포트)가 같아야 브라우저에 자동 저장된 작업이 다음 실행 때도 보인다. 그래서 고정 포트를 먼저 쓴다.
var ports = []int{47823, 47824, 47825, 47826}

const (
	// 화면은 10초마다 신호를 보낸다. 창을 최소화하면 브라우저가 타이머를 1분에 한 번으로 늦추므로 넉넉히 기다린다.
	heartbeatTimeout = 3 * time.Minute
	// 창을 닫으면 화면이 "닫힘" 신호를 보낸다. 새로고침이면 곧 다시 신호가 오므로 잠깐 기다렸다가 끝낸다.
	closeGrace = 6 * time.Second
	// 처음 창이 뜨기를 기다리는 시간
	firstContactTimeout = 5 * time.Minute
)

type state struct {
	mu        sync.Mutex
	lastBeat  time.Time
	contacted bool
	closing   *time.Timer
}

func main() {
	// 이미 실행 중이면 창만 하나 더 연다.
	for _, p := range ports {
		url := fmt.Sprintf("http://127.0.0.1:%d/", p)
		if isOurs(url) {
			if err := openApp(url); err != nil {
				showMessage("캐릭터 에셋 공방", "창을 열지 못했습니다. 브라우저에서 다음 주소를 여세요:\n"+url)
			}
			return
		}
	}

	var ln net.Listener
	var url string
	var err error
	for _, p := range ports {
		ln, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		if err == nil {
			url = fmt.Sprintf("http://127.0.0.1:%d/", p)
			break
		}
	}
	if ln == nil {
		showMessage("캐릭터 에셋 공방", "프로그램을 시작하지 못했습니다(포트 47823~47826을 모두 다른 프로그램이 쓰고 있습니다).\n"+err.Error())
		os.Exit(1)
	}

	st := &state{}
	web, _ := fs.Sub(webFiles, "web")
	files := http.FileServer(http.FS(web))

	mux := http.NewServeMux()
	mux.HandleFunc("/__launcher", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(map[string]string{"app": appID})
	})
	mux.HandleFunc("/__heartbeat", func(w http.ResponseWriter, r *http.Request) {
		st.beat()
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/__bye", func(w http.ResponseWriter, r *http.Request) {
		st.bye()
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// 화면 파일이 바뀌어도 예전 것이 남지 않게 한다.
		w.Header().Set("Cache-Control", "no-cache")
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path != "" {
			if _, err := fs.Stat(web, path); err != nil {
				r.URL.Path = "/"
			}
		}
		files.ServeHTTP(w, r)
	})

	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			showMessage("캐릭터 에셋 공방", "프로그램이 멈췄습니다: "+err.Error())
			os.Exit(1)
		}
	}()

	if err := openApp(url); err != nil {
		showMessage("캐릭터 에셋 공방", "창을 열지 못했습니다. 브라우저에서 다음 주소를 여세요:\n"+url)
	}
	st.watch()
}

func (s *state) beat() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastBeat = time.Now()
	s.contacted = true
	if s.closing != nil {
		s.closing.Stop()
		s.closing = nil
	}
}

func (s *state) bye() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closing != nil {
		s.closing.Stop()
	}
	s.closing = time.AfterFunc(closeGrace, func() { os.Exit(0) })
}

// 신호가 끊기면 끝낸다.
func (s *state) watch() {
	start := time.Now()
	for {
		time.Sleep(5 * time.Second)
		s.mu.Lock()
		contacted, last := s.contacted, s.lastBeat
		s.mu.Unlock()
		if !contacted && time.Since(start) > firstContactTimeout {
			os.Exit(0)
		}
		if contacted && time.Since(last) > heartbeatTimeout {
			os.Exit(0)
		}
	}
}

func isOurs(url string) bool {
	c := http.Client{Timeout: 800 * time.Millisecond}
	res, err := c.Get(url + "__launcher")
	if err != nil {
		return false
	}
	defer res.Body.Close()
	var info map[string]string
	if json.NewDecoder(res.Body).Decode(&info) != nil {
		return false
	}
	return info["app"] == appID
}
