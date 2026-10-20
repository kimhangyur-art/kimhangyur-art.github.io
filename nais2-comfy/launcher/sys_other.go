//go:build !windows

package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// Windows가 아닌 곳(개발·시험용): 기본 브라우저로 연다.
func openApp(url string) error {
	if os.Getenv("NC_NO_BROWSER") != "" {
		fmt.Println("열 주소:", url)
		return nil
	}
	if runtime.GOOS == "darwin" {
		return exec.Command("open", url).Start()
	}
	return exec.Command("xdg-open", url).Start()
}

func showMessage(title, text string) {
	fmt.Fprintf(os.Stderr, "[%s] %s\n", title, text)
}

func userFolder(kind, home string) string {
	names := map[string]string{"Picture": "Pictures", "Document": "Documents", "Download": "Downloads", "Desktop": "Desktop"}
	return filepath.Join(home, names[kind])
}

func openPath(p string) error {
	if os.Getenv("NC_NO_BROWSER") != "" {
		fmt.Println("열기:", p)
		return nil
	}
	if runtime.GOOS == "darwin" {
		return exec.Command("open", p).Start()
	}
	return exec.Command("xdg-open", p).Start()
}

func revealPath(p string) error { return openPath(filepath.Dir(p)) }

func openURL(u string) error { return openPath(u) }

// 시험용: NC_DIALOG_RESULT 에 적힌 경로를 고른 것으로 친다 (없으면 취소)
func showDialog(kind string, req dialogReq) ([]string, error) {
	if kind != "folder" && kind != "open" && kind != "save" {
		return nil, errors.New("unknown dialog")
	}
	if v := os.Getenv("NC_DIALOG_RESULT"); v != "" {
		return []string{v}, nil
	}
	return nil, nil
}
