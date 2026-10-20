//go:build windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

const createNoWindow = 0x08000000

// Edge → Chrome 순으로 찾아 주소창 없는 앱 창으로 연다. 둘 다 없으면 기본 브라우저.
// 이 앱 전용 브라우저 프로필을 써서 설정·작업 기록이 평소 쓰는 브라우저와 섞이지 않게 한다.
func openApp(url string) error {
	profile := filepath.Join(knownDirs()["AppLocalData"], "browser")
	_ = os.MkdirAll(profile, 0o755)
	for _, exe := range browserCandidates() {
		if _, err := os.Stat(exe); err != nil {
			continue
		}
		cmd := exec.Command(exe,
			"--app="+url,
			"--user-data-dir="+profile,
			"--no-first-run",
			"--no-default-browser-check",
			"--window-size=1600,960",
		)
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

// 사진·문서 폴더 등은 OneDrive로 옮겨져 있을 수 있어서 Windows에 직접 묻는다 (SHGetKnownFolderPath).
var folderIDs = map[string]syscall.GUID{
	"Picture":  {Data1: 0x33E28130, Data2: 0x4E1E, Data3: 0x4676, Data4: [8]byte{0x83, 0x5A, 0x98, 0x39, 0x5C, 0x3B, 0xC3, 0xBB}},
	"Document": {Data1: 0xFDD39AD0, Data2: 0x238F, Data3: 0x46AF, Data4: [8]byte{0xAD, 0xB4, 0x6C, 0x85, 0x48, 0x03, 0x69, 0xC7}},
	"Download": {Data1: 0x374DE290, Data2: 0x123F, Data3: 0x4565, Data4: [8]byte{0x91, 0x64, 0x39, 0xC4, 0x92, 0x5E, 0x46, 0x7B}},
	"Desktop":  {Data1: 0xB4BFCC3A, Data2: 0xDB2C, Data3: 0x424C, Data4: [8]byte{0xB0, 0x29, 0x7F, 0xE9, 0x9A, 0x87, 0xC6, 0x41}},
}

func userFolder(kind, home string) string {
	if id, ok := folderIDs[kind]; ok {
		shell32 := syscall.NewLazyDLL("shell32.dll")
		ole32 := syscall.NewLazyDLL("ole32.dll")
		proc := shell32.NewProc("SHGetKnownFolderPath")
		var p *uint16
		r, _, _ := proc.Call(uintptr(unsafe.Pointer(&id)), 0, 0, uintptr(unsafe.Pointer(&p)))
		if r == 0 && p != nil {
			s := syscall.UTF16ToString(unsafe.Slice(p, 32767))
			ole32.NewProc("CoTaskMemFree").Call(uintptr(unsafe.Pointer(p)))
			if s != "" {
				return s
			}
		}
	}
	names := map[string]string{"Picture": "Pictures", "Document": "Documents", "Download": "Downloads", "Desktop": "Desktop"}
	return filepath.Join(home, names[kind])
}

func hidden(cmd *exec.Cmd) *exec.Cmd {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	return cmd
}

func openPath(p string) error {
	if _, err := os.Stat(p); err != nil {
		return err
	}
	return exec.Command("explorer.exe", p).Start()
}

func revealPath(p string) error {
	if _, err := os.Stat(p); err != nil {
		return err
	}
	cmd := exec.Command("explorer.exe")
	// explorer는 /select, 뒤 경로를 따옴표로 감싸야 공백이 있어도 된다
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: `explorer.exe /select,"` + p + `"`}
	return cmd.Start()
}

func openURL(u string) error {
	return exec.Command("rundll32", "url.dll,FileProtocolHandler", u).Start()
}

// PowerShell(Windows 기본 포함)로 파일 고르기 창을 띄운다. 맨 위에 뜨도록 보이지 않는 TopMost 창을 주인으로 쓴다.
func showDialog(kind string, req dialogReq) ([]string, error) {
	var script strings.Builder
	script.WriteString(`[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.WindowState = 'Minimized'
`)
	title := psQuote(req.Title)
	def := psQuote(req.DefaultPath)
	filter := psQuote(dialogFilter(req))
	switch kind {
	case "folder":
		script.WriteString(`$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = ` + title + `
$d.ShowNewFolderButton = $true
if (` + def + ` -ne '' -and (Test-Path ` + def + `)) { $d.SelectedPath = ` + def + ` }
if ($d.ShowDialog($owner) -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }
`)
	case "open":
		multi := "$false"
		if req.Multiple {
			multi = "$true"
		}
		script.WriteString(`$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Title = ` + title + `
$d.Multiselect = ` + multi + `
if (` + filter + ` -ne '') { $d.Filter = ` + filter + ` }
if (` + def + ` -ne '' -and (Test-Path ` + def + ` -PathType Container)) { $d.InitialDirectory = ` + def + ` }
if ($d.ShowDialog($owner) -eq 'OK') { [Console]::Out.Write(($d.FileNames -join "` + "`n" + `")) }
`)
	case "save":
		script.WriteString(`$d = New-Object System.Windows.Forms.SaveFileDialog
$d.Title = ` + title + `
if (` + filter + ` -ne '') { $d.Filter = ` + filter + ` }
$def = ` + def + `
if ($def -ne '') {
  if (Test-Path $def -PathType Container) { $d.InitialDirectory = $def }
  else { $d.FileName = [System.IO.Path]::GetFileName($def); $dir = [System.IO.Path]::GetDirectoryName($def); if ($dir -and (Test-Path $dir)) { $d.InitialDirectory = $dir } }
}
if ($d.ShowDialog($owner) -eq 'OK') { [Console]::Out.Write($d.FileName) }
`)
	default:
		return nil, errors.New("unknown dialog")
	}
	script.WriteString("$owner.Dispose()\n")
	cmd := hidden(exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-Command", "-"))
	cmd.Stdin = strings.NewReader(script.String())
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	text := strings.TrimSpace(string(out))
	if text == "" {
		return nil, nil
	}
	var paths []string
	for _, line := range strings.Split(text, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			paths = append(paths, line)
		}
	}
	return paths, nil
}

func psQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

func dialogFilter(req dialogReq) string {
	var parts []string
	for _, f := range req.Filters {
		var pats []string
		for _, e := range f.Extensions {
			e = strings.TrimPrefix(strings.TrimSpace(e), ".")
			if e == "" || strings.ContainsAny(e, "|;") {
				continue
			}
			pats = append(pats, "*."+e)
		}
		if len(pats) == 0 {
			continue
		}
		name := strings.ReplaceAll(f.Name, "|", " ")
		parts = append(parts, name+"|"+strings.Join(pats, ";"))
	}
	if len(parts) > 0 {
		parts = append(parts, "모든 파일|*.*")
	}
	return strings.Join(parts, "|")
}
