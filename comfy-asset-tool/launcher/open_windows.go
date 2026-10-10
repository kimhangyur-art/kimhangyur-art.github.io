//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

// Edge → Chrome 순으로 찾아 주소창 없는 앱 창으로 연다. 둘 다 없으면 기본 브라우저.
func openApp(url string) error {
	for _, exe := range browserCandidates() {
		if _, err := os.Stat(exe); err != nil {
			continue
		}
		cmd := exec.Command(exe, "--app="+url, "--window-size=1440,920")
		if err := cmd.Start(); err == nil {
			return nil
		}
	}
	return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

func browserCandidates() []string {
	var out []string
	roots := []string{os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramFiles"), os.Getenv("LocalAppData")}
	for _, r := range roots {
		if r != "" {
			out = append(out, filepath.Join(r, "Microsoft", "Edge", "Application", "msedge.exe"))
		}
	}
	for _, r := range roots {
		if r != "" {
			out = append(out, filepath.Join(r, "Google", "Chrome", "Application", "chrome.exe"))
		}
	}
	return out
}

func showMessage(title, text string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	box := user32.NewProc("MessageBoxW")
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(text)
	const mbIconInformation = 0x40
	_, _, _ = box.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), mbIconInformation)
}
