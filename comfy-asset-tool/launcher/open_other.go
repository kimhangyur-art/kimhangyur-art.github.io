//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
)

// Windows가 아닌 곳(개발·시험용): 기본 브라우저로 연다.
func openApp(url string) error {
	if os.Getenv("ASSET_TOOL_NO_BROWSER") != "" {
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
