package main

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// /__api/ — 화면의 Tauri 대체 모듈(src/shims)이 부르는 주소들.
// 경로는 모두 절대 경로로 받는다(BaseDirectory는 화면 쪽에서 /__api/info 의 폴더로 바꿔 보낸다).
func (a *app) api(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/__api/")
	group, op, _ := strings.Cut(rest, "/")
	switch group {
	case "info":
		a.info(w)
	case "fs":
		a.fsAPI(w, r, op)
	case "file":
		a.serveLocalFile(w, r)
	case "open":
		a.openAPI(w, r, op)
	case "dialog":
		a.dialogAPI(w, r, op)
	case "comfy":
		a.comfyAPI(w, r, op)
	case "store":
		a.storeAPI(w, r, op)
	default:
		writeError(w, http.StatusNotFound, "unknown api")
	}
}

func (a *app) info(w http.ResponseWriter) {
	exe, _ := os.Executable()
	writeJSON(w, map[string]any{
		"app":      appID,
		"platform": runtime.GOOS,
		"sep":      string(filepath.Separator),
		"dirs":     knownDirs(),
		"exeDir":   filepath.Dir(exe),
	})
}

// 알려진 폴더 (Tauri BaseDirectory 이름과 같은 키)
func knownDirs() map[string]string {
	home, _ := os.UserHomeDir()
	config, _ := os.UserConfigDir()
	cache, _ := os.UserCacheDir()
	if root := os.Getenv("NC_DATA_ROOT"); root != "" {
		// 시험용: 모든 폴더를 한 곳 아래로 모은다
		home = root
		config = filepath.Join(root, "AppData", "Roaming")
		cache = filepath.Join(root, "AppData", "Local")
	}
	d := map[string]string{
		"Home":         home,
		"AppData":      filepath.Join(config, appTitle),
		"AppConfig":    filepath.Join(config, appTitle),
		"AppLocalData": filepath.Join(cache, appTitle),
		"AppCache":     filepath.Join(cache, appTitle, "cache"),
		"AppLog":       filepath.Join(cache, appTitle, "logs"),
		"Temp":         os.TempDir(),
		"Picture":      userFolder("Picture", home),
		"Document":     userFolder("Document", home),
		"Download":     userFolder("Download", home),
		"Desktop":      userFolder("Desktop", home),
	}
	if os.Getenv("NC_DATA_ROOT") != "" {
		for _, k := range []string{"Picture", "Document", "Download", "Desktop"} {
			d[k] = filepath.Join(home, k+"s")
		}
	}
	return d
}

type fsReq struct {
	Path      string `json:"path"`
	From      string `json:"from"`
	To        string `json:"to"`
	Recursive bool   `json:"recursive"`
	Text      string `json:"text"`
	Append    bool   `json:"append"`
}

func cleanAbs(p string) (string, error) {
	if p == "" {
		return "", errors.New("경로가 비어 있습니다")
	}
	p = filepath.FromSlash(p)
	if !filepath.IsAbs(p) {
		return "", errors.New("절대 경로가 아닙니다: " + p)
	}
	return filepath.Clean(p), nil
}

func (a *app) fsAPI(w http.ResponseWriter, r *http.Request, op string) {
	// writeFile 은 본문이 파일 내용이고 경로는 쿼리로 받는다
	if op == "writeFile" {
		p, err := cleanAbs(r.URL.Query().Get("path"))
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		flag := os.O_CREATE | os.O_WRONLY | os.O_TRUNC
		if r.URL.Query().Get("append") == "1" {
			flag = os.O_CREATE | os.O_WRONLY | os.O_APPEND
		}
		// 다 쓴 뒤에 바꿔 넣어 쓰다 만 파일이 남지 않게 한다 (덧붙이기는 예외)
		if flag&os.O_APPEND == 0 {
			tmp := p + ".part"
			f, err := os.OpenFile(tmp, flag, 0o644)
			if err == nil {
				_, err = io.Copy(f, r.Body)
				if cerr := f.Close(); err == nil {
					err = cerr
				}
			}
			if err == nil {
				err = os.Rename(tmp, p)
			}
			if err != nil {
				_ = os.Remove(tmp)
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
		} else {
			f, err := os.OpenFile(p, flag, 0o644)
			if err == nil {
				_, err = io.Copy(f, r.Body)
				if cerr := f.Close(); err == nil {
					err = cerr
				}
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}

	var req fsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "요청 형식 오류: "+err.Error())
		return
	}
	switch op {
	case "readFile":
		p, err := cleanAbs(req.Path)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		f, err := os.Open(p)
		if err != nil {
			writeFsError(w, err)
			return
		}
		defer f.Close()
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = io.Copy(w, f)
	case "exists":
		p, err := cleanAbs(req.Path)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		_, err = os.Stat(p)
		writeJSON(w, map[string]bool{"exists": err == nil})
	case "stat":
		p, err := cleanAbs(req.Path)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		st, err := os.Stat(p)
		if err != nil {
			writeFsError(w, err)
			return
		}
		writeJSON(w, statJSON(st))
	case "mkdir":
		p, err := cleanAbs(req.Path)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.Recursive {
			err = os.MkdirAll(p, 0o755)
		} else {
			err = os.Mkdir(p, 0o755)
		}
		if err != nil {
			writeFsError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	case "readDir":
		p, err := cleanAbs(req.Path)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		entries, err := os.ReadDir(p)
		if err != nil {
			writeFsError(w, err)
			return
		}
		out := make([]map[string]any, 0, len(entries))
		for _, e := range entries {
			item := map[string]any{
				"name":        e.Name(),
				"isDirectory": e.IsDir(),
				"isFile":      e.Type().IsRegular(),
				"isSymlink":   e.Type()&fs.ModeSymlink != 0,
			}
			if info, err := e.Info(); err == nil {
				item["size"] = info.Size()
				item["mtime"] = info.ModTime().UnixMilli()
			}
			out = append(out, item)
		}
		writeJSON(w, out)
	case "remove":
		p, err := cleanAbs(req.Path)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if len(p) <= 3 || p == filepath.Dir(p) {
			writeError(w, http.StatusBadRequest, "드라이브 최상위는 지울 수 없습니다")
			return
		}
		if req.Recursive {
			err = os.RemoveAll(p)
		} else {
			err = os.Remove(p)
		}
		if err != nil {
			writeFsError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	case "rename", "copyFile":
		from, err := cleanAbs(req.From)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		to, err := cleanAbs(req.To)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if op == "rename" {
			err = os.Rename(from, to)
		} else {
			err = copyFile(from, to)
		}
		if err != nil {
			writeFsError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		writeError(w, http.StatusNotFound, "unknown fs op: "+op)
	}
}

func statJSON(st os.FileInfo) map[string]any {
	return map[string]any{
		"isFile":      st.Mode().IsRegular(),
		"isDirectory": st.IsDir(),
		"isSymlink":   st.Mode()&fs.ModeSymlink != 0,
		"size":        st.Size(),
		"mtime":       st.ModTime().UnixMilli(),
		"readonly":    st.Mode().Perm()&0o200 == 0,
	}
}

func writeFsError(w http.ResponseWriter, err error) {
	code := http.StatusInternalServerError
	if errors.Is(err, fs.ErrNotExist) {
		code = http.StatusNotFound
	} else if errors.Is(err, fs.ErrExist) {
		code = http.StatusConflict
	} else if errors.Is(err, fs.ErrPermission) {
		code = http.StatusForbidden
	}
	writeError(w, code, err.Error())
}

func copyFile(from, to string) error {
	src, err := os.Open(from)
	if err != nil {
		return err
	}
	defer src.Close()
	if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
		return err
	}
	dst, err := os.Create(to)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		return err
	}
	return dst.Close()
}

// GET /__api/file?path=...&t=... — 이미지 태그(<img src>)로 로컬 파일을 보여 줄 때 쓴다 (Tauri convertFileSrc 대체)
func (a *app) serveLocalFile(w http.ResponseWriter, r *http.Request) {
	p, err := cleanAbs(r.URL.Query().Get("path"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	f, err := os.Open(p)
	if err != nil {
		writeFsError(w, err)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		writeError(w, http.StatusBadRequest, "파일이 아닙니다")
		return
	}
	if ct := mime.TypeByExtension(strings.ToLower(filepath.Ext(p))); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, filepath.Base(p), st.ModTime(), f)
}

// POST /__api/open/path {path}   폴더나 파일을 기본 프로그램(탐색기)으로 연다
// POST /__api/open/reveal {path} 탐색기에서 파일을 선택한 채로 연다
// POST /__api/open/url {url}     기본 브라우저로 연다
func (a *app) openAPI(w http.ResponseWriter, r *http.Request, op string) {
	var req struct {
		Path string `json:"path"`
		URL  string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var err error
	switch op {
	case "path":
		var p string
		if p, err = cleanAbs(req.Path); err == nil {
			err = openPath(p)
		}
	case "reveal":
		var p string
		if p, err = cleanAbs(req.Path); err == nil {
			err = revealPath(p)
		}
	case "url":
		if !strings.HasPrefix(req.URL, "http://") && !strings.HasPrefix(req.URL, "https://") {
			err = errors.New("http(s) 주소만 열 수 있습니다")
		} else {
			err = openURL(req.URL)
		}
	default:
		err = errors.New("unknown open op")
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /__api/dialog/{folder|open|save} — Windows 파일 고르기 창. 취소하면 {paths: null}
type dialogReq struct {
	Title       string `json:"title"`
	DefaultPath string `json:"defaultPath"`
	Multiple    bool   `json:"multiple"`
	Filters     []struct {
		Name       string   `json:"name"`
		Extensions []string `json:"extensions"`
	} `json:"filters"`
}

func (a *app) dialogAPI(w http.ResponseWriter, r *http.Request, op string) {
	var req dialogReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	paths, err := showDialog(op, req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]any{"paths": paths})
}

// 간단한 키-값 저장소 (Tauri plugin-store 대체). AppData/NAIS2 Comfy/store/<name>.json
func (a *app) storeAPI(w http.ResponseWriter, r *http.Request, op string) {
	name := filepath.Base(r.URL.Query().Get("name"))
	if name == "" || name == "." || strings.ContainsAny(name, `/\`) {
		writeError(w, http.StatusBadRequest, "bad store name")
		return
	}
	dir := filepath.Join(knownDirs()["AppData"], "store")
	p := filepath.Join(dir, name)
	switch op {
	case "load":
		b, err := os.ReadFile(p)
		if errors.Is(err, fs.ErrNotExist) {
			writeJSON(w, map[string]any{})
			return
		}
		if err != nil {
			writeFsError(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = w.Write(b)
	case "save":
		b, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
		if err != nil || !json.Valid(b) {
			writeError(w, http.StatusBadRequest, "JSON이 아닙니다")
			return
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			writeFsError(w, err)
			return
		}
		tmp := p + ".part"
		if err := os.WriteFile(tmp, b, 0o644); err != nil {
			writeFsError(w, err)
			return
		}
		if err := os.Rename(tmp, p); err != nil {
			writeFsError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		writeError(w, http.StatusNotFound, "unknown store op")
	}
}

// 런처 설정 (ComfyUI 주소)
type config struct {
	ComfyURL string `json:"comfyUrl"`
	path     string
}

func loadConfig() *config {
	c := &config{ComfyURL: defaultComfyURL, path: filepath.Join(knownDirs()["AppData"], "launcher.json")}
	if b, err := os.ReadFile(c.path); err == nil {
		_ = json.Unmarshal(b, c)
	}
	return c
}

func (c *config) save() {
	_ = os.MkdirAll(filepath.Dir(c.path), 0o755)
	b, _ := json.MarshalIndent(c, "", "  ")
	_ = os.WriteFile(c.path, b, 0o644)
}
