// NAIS2 Comfy 실행 파일.
//
// 화면 파일(web/)을 exe 안에 넣어 두고 이 컴퓨터 안에서만 열리는 주소(127.0.0.1)로 띄운 뒤
// Edge(없으면 Chrome, 그것도 없으면 기본 브라우저)를 주소창 없는 앱 창으로 연다.
// Tauri가 하던 일(파일 읽기·쓰기, 폴더 열기, 파일 고르기 창)은 /__api/ 아래 주소로 대신하고,
// ComfyUI 요청은 /comfy/ 아래로 받아 그대로 넘겨 준다(CORS 설정 없이 ComfyUI를 쓸 수 있다).
// 창을 닫으면 화면이 보내던 신호가 끊겨 프로그램도 스스로 끝난다.
//
// 빌드: npm run build:exe
package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
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

const (
	appID    = "nais2-comfy"
	appTitle = "NAIS2 Comfy"
)

// 주소(포트)가 같아야 브라우저에 저장된 설정이 다음 실행 때도 보인다. 그래서 고정 포트를 먼저 쓴다.
var ports = []int{47900, 47901, 47902, 47903}

const (
	heartbeatTimeout    = 3 * time.Minute
	closeGrace          = 6 * time.Second
	firstContactTimeout = 5 * time.Minute
)

type app struct {
	token  string
	origin string // http://127.0.0.1:47900
	port   int
	web    fs.FS
	comfy  *comfyProxy
	conf   *config

	mu        sync.Mutex
	lastBeat  time.Time
	contacted bool
	closing   *time.Timer
}

func main() {
	for _, p := range ports {
		url := fmt.Sprintf("http://127.0.0.1:%d/", p)
		if isOurs(url) {
			if err := openApp(url); err != nil {
				showMessage(appTitle, "창을 열지 못했습니다. 브라우저에서 다음 주소를 여세요:\n"+url)
			}
			return
		}
	}

	var ln net.Listener
	var port int
	var err error
	for _, p := range ports {
		ln, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		if err == nil {
			port = p
			break
		}
	}
	if ln == nil {
		showMessage(appTitle, "프로그램을 시작하지 못했습니다(포트 47900~47903을 모두 다른 프로그램이 쓰고 있습니다).\n"+err.Error())
		os.Exit(1)
	}

	web, _ := fs.Sub(webFiles, "web")
	conf := loadConfig()
	a := &app{
		token:  newToken(),
		origin: fmt.Sprintf("http://127.0.0.1:%d", port),
		port:   port,
		web:    web,
		conf:   conf,
	}
	a.comfy = newComfyProxy(conf.ComfyURL)

	srv := &http.Server{Handler: a.routes(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			showMessage(appTitle, "프로그램이 멈췄습니다: "+err.Error())
			os.Exit(1)
		}
	}()

	url := a.origin + "/"
	if err := openApp(url); err != nil {
		showMessage(appTitle, "창을 열지 못했습니다. 브라우저에서 다음 주소를 여세요:\n"+url)
	}
	a.watch()
}

func newToken() string {
	// 개발용: NC_TOKEN 을 주면 그 값을 쓴다 (vite 개발 서버가 같은 값을 VITE_NC_TOKEN 으로 쓴다)
	if t := os.Getenv("NC_TOKEN"); t != "" {
		return t
	}
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (a *app) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/__launcher", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, map[string]string{"app": appID})
	})
	mux.HandleFunc("/__heartbeat", func(w http.ResponseWriter, r *http.Request) {
		a.beat()
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/__bye", func(w http.ResponseWriter, r *http.Request) {
		a.bye()
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/__api/", a.api)
	mux.HandleFunc("/comfy/", a.comfyHandler)
	mux.HandleFunc("/", a.static)
	return a.guard(mux)
}

// guard: 이 컴퓨터의 다른 웹페이지가 파일 API나 ComfyUI 중계를 쓰지 못하게 막는다.
//   - Host가 127.0.0.1/localhost가 아니면 거절 (DNS 재바인딩 방지)
//   - Origin이 붙은 요청은 이 앱 주소에서 온 것만 받는다
//   - /__api/ 와 /comfy/ 는 화면에 심어 둔 토큰(X-NC-Token 헤더 또는 t= 값)이 있어야 한다
func (a *app) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := strings.ToLower(r.Host)
		if host != fmt.Sprintf("127.0.0.1:%d", a.port) && host != fmt.Sprintf("localhost:%d", a.port) {
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
		}
		if o := r.Header.Get("Origin"); o != "" && o != "null" {
			if !strings.EqualFold(o, "http://"+host) {
				http.Error(w, "forbidden origin", http.StatusForbidden)
				return
			}
		}
		if strings.HasPrefix(r.URL.Path, "/__api/") || strings.HasPrefix(r.URL.Path, "/comfy/") {
			t := r.Header.Get("X-NC-Token")
			if t == "" {
				t = r.URL.Query().Get("t")
			}
			if t != a.token {
				http.Error(w, "missing token", http.StatusUnauthorized)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (a *app) static(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/")
	if path != "" && path != "index.html" {
		if st, err := fs.Stat(a.web, path); err == nil && !st.IsDir() {
			if strings.HasPrefix(path, "assets/") {
				// 빌드 파일 이름에 내용 해시가 들어 있어 오래 보관해도 된다.
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				w.Header().Set("Cache-Control", "no-cache")
			}
			http.ServeFileFS(w, r, a.web, path)
			return
		}
	}
	// 그 밖의 주소는 모두 화면(index.html)으로 보낸다 (react-router 경로).
	b, err := fs.ReadFile(a.web, "index.html")
	if err != nil {
		http.Error(w, "index.html missing", http.StatusInternalServerError)
		return
	}
	meta := fmt.Sprintf(`<meta name="nc-token" content="%s"><meta name="nc-launcher" content="1">`, a.token)
	html := strings.Replace(string(b), "</head>", meta+"</head>", 1)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(html))
}

func (a *app) beat() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.lastBeat = time.Now()
	a.contacted = true
	if a.closing != nil {
		a.closing.Stop()
		a.closing = nil
	}
}

func (a *app) bye() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closing != nil {
		a.closing.Stop()
	}
	a.closing = time.AfterFunc(closeGrace, func() { os.Exit(0) })
}

func (a *app) watch() {
	if os.Getenv("NC_NO_EXIT") != "" {
		select {}
	}
	start := time.Now()
	for {
		time.Sleep(5 * time.Second)
		a.mu.Lock()
		contacted, last := a.contacted, a.lastBeat
		a.mu.Unlock()
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

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
