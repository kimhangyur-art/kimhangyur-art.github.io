package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"
)

// comfyProxy: /comfy/<경로> 요청을 ComfyUI 주소로 넘긴다 (WebSocket 포함).
// ComfyUI는 CORS를 켜지 않으면 Host와 Origin이 다른 요청을 거절하므로, 넘길 때 Origin·Referer를 지운다.
type comfyProxy struct {
	mu     sync.RWMutex
	target *url.URL
	proxy  *httputil.ReverseProxy
}

const defaultComfyURL = "http://127.0.0.1:8188"

func newComfyProxy(raw string) *comfyProxy {
	p := &comfyProxy{}
	if err := p.set(raw); err != nil {
		_ = p.set(defaultComfyURL)
	}
	return p
}

func normalizeComfyURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = defaultComfyURL
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, &url.Error{Op: "parse", URL: raw, Err: errBadScheme}
	}
	u.Path = strings.TrimRight(u.Path, "/")
	u.RawQuery = ""
	u.Fragment = ""
	return u, nil
}

type constError string

func (e constError) Error() string { return string(e) }

const errBadScheme = constError("http 또는 https 주소여야 합니다")

func (p *comfyProxy) set(raw string) error {
	u, err := normalizeComfyURL(raw)
	if err != nil {
		return err
	}
	rp := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			rest := strings.TrimPrefix(r.In.URL.Path, "/comfy")
			r.Out.URL.Scheme = u.Scheme
			r.Out.URL.Host = u.Host
			r.Out.URL.Path = u.Path + rest
			r.Out.URL.RawPath = ""
			q := r.In.URL.Query()
			q.Del("t")
			r.Out.URL.RawQuery = q.Encode()
			r.Out.Host = u.Host
			r.Out.Header.Del("Origin")
			r.Out.Header.Del("Referer")
			r.Out.Header.Del("X-NC-Token")
			r.Out.Header.Del("Cookie")
		},
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			writeError(w, http.StatusBadGateway, "ComfyUI에 연결하지 못했습니다 ("+u.String()+"): "+err.Error())
		},
	}
	p.mu.Lock()
	p.target, p.proxy = u, rp
	p.mu.Unlock()
	return nil
}

func (p *comfyProxy) get() (*url.URL, *httputil.ReverseProxy) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.target, p.proxy
}

func (a *app) comfyHandler(w http.ResponseWriter, r *http.Request) {
	_, rp := a.comfy.get()
	rp.ServeHTTP(w, r)
}

// GET  /__api/comfy/target → {url}
// POST /__api/comfy/target {url} → 주소를 바꾸고 저장
// GET  /__api/comfy/ping   → {ok, url, version?, error?}
func (a *app) comfyAPI(w http.ResponseWriter, r *http.Request, op string) {
	switch op {
	case "target":
		if r.Method == http.MethodPost {
			var body struct {
				URL string `json:"url"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			if err := a.comfy.set(body.URL); err != nil {
				writeError(w, http.StatusBadRequest, "주소 형식이 맞지 않습니다: "+err.Error())
				return
			}
			u, _ := a.comfy.get()
			a.conf.ComfyURL = u.String()
			a.conf.save()
		}
		u, _ := a.comfy.get()
		writeJSON(w, map[string]string{"url": u.String()})
	case "ping":
		u, _ := a.comfy.get()
		c := http.Client{Timeout: 3 * time.Second}
		res, err := c.Get(u.String() + "/system_stats")
		if err != nil {
			writeJSON(w, map[string]any{"ok": false, "url": u.String(), "error": err.Error()})
			return
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		if res.StatusCode != http.StatusOK {
			writeJSON(w, map[string]any{"ok": false, "url": u.String(), "error": res.Status})
			return
		}
		var stats struct {
			System struct {
				ComfyUIVersion string `json:"comfyui_version"`
			} `json:"system"`
			Devices []struct {
				Name string `json:"name"`
			} `json:"devices"`
		}
		_ = json.Unmarshal(b, &stats)
		device := ""
		if len(stats.Devices) > 0 {
			device = stats.Devices[0].Name
		}
		writeJSON(w, map[string]any{"ok": true, "url": u.String(), "version": stats.System.ComfyUIVersion, "device": device})
	default:
		writeError(w, http.StatusNotFound, "unknown comfy op")
	}
}
