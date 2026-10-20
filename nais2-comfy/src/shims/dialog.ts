// @tauri-apps/plugin-dialog 대체 (Windows 파일 고르기 창은 실행 파일이 띄운다)
export { openDialog as open, saveDialog as save, message, ask, confirm } from './tauri-misc'
export type { OpenDialogOptions, SaveDialogOptions, DialogFilter } from './tauri-misc'
