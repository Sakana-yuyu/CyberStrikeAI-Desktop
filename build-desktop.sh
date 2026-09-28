#!/usr/bin/env bash
# 构建桌面端（Windows）：进程内启动服务 + WebView2 原生窗口
#
# 用法:
#   ./build-desktop.sh             # GUI 模式（无控制台窗口，双击即用）
#   ./build-desktop.sh --console   # 控制台模式（保留终端输出，便于排查）
#   OUT=xxx.exe ./build-desktop.sh # 指定输出文件
#
# 运行要求:
#   - exe 需与 web/、config.example.yaml、roles/、skills/ 等资源目录在同一目录
#   - Windows 10/11 一般自带 WebView2 运行时；缺失时程序会自动退化为默认浏览器
set -euo pipefail
cd "$(dirname "$0")"

OUT="${OUT:-}"
LDFLAGS="-s -w -extldflags=-specs=cmd/desktop/no-default-manifest.specs"
if [ "${1:-}" = "--console" ]; then
  OUT="${OUT:-CyberStrikeAI-Desktop-console.exe}"
else
  LDFLAGS="-H=windowsgui $LDFLAGS"
  OUT="${OUT:-CyberStrikeAI-Desktop.exe}"
fi

# 图标/版本信息资源（web/static/favicon.ico 同源）。
# 桌面构建本就依赖 MinGW-w64（CGO/sqlite3），windres 通常随包可用。
find_windres() {
  if command -v windres >/dev/null 2>&1; then
    command -v windres
    return 0
  fi
  local candidate
  for candidate in \
    "/c/Users/$USER/AppData/Local/Microsoft/WinGet/Packages"/*/mingw64/bin/windres.exe \
    "/c/Program Files/mingw64/bin/windres.exe" \
    "/c/mingw64/bin/windres.exe"; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

if WINDRES_BIN="$(find_windres)"; then
  cp -f web/static/favicon.ico cmd/desktop/icon.ico
  (cd cmd/desktop && "$WINDRES_BIN" -O coff windows_resource.rc -o resource_windows_amd64.syso)
  echo "已编译图标资源: cmd/desktop/resource_windows_amd64.syso"
elif [ -f cmd/desktop/resource_windows_amd64.syso ]; then
  echo "未找到 windres，使用已存在的图标资源"
else
  echo "警告: 未找到 windres 且无已编译 .syso，exe 将没有应用图标" >&2
fi

# 项目依赖 mattn/go-sqlite3，必须开启 CGO（需要 gcc/MinGW-w64）
CGO_ENABLED=1 go build -trimpath -ldflags "$LDFLAGS" -o "$OUT" ./cmd/desktop

echo "构建完成: $OUT"
echo "提示: 请将 exe 与项目资源目录（web/、config.example.yaml、roles/ 等）放在同一目录后运行"
