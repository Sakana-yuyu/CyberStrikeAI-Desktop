#!/usr/bin/env bash
# 打包 Windows 安装程序（NSIS）：构建桌面 exe → 暂存资源 → 生成 dist\CyberStrikeAI-Setup-<ver>-x64.exe
#
# 用法:
#   ./build-installer.sh              # 完整流程（构建 GUI + console exe 并打包）
#   ./build-installer.sh --no-build   # 跳过构建，直接打包已有 exe（用于调试 .nsi）
#
# 依赖: MinGW-w64（CGO/sqlite3 与 windres）、NSIS 3（默认取 C:\Program Files (x86)\NSIS）
set -euo pipefail
cd "$(dirname "$0")"

MAKENSIS="${MAKENSIS:-/c/Program Files (x86)/NSIS/makensis.exe}"
if [ ! -x "$MAKENSIS" ]; then
  MAKENSIS="$(command -v makensis.exe || true)"
fi
if [ -z "${MAKENSIS:-}" ] || [ ! -x "$MAKENSIS" ]; then
  echo "错误: 未找到 makensis（NSIS）。安装 NSIS 3 后重试，或用 MAKENSIS=/path/to/makensis.exe 指定。" >&2
  exit 1
fi

VERSION="$(grep -oP '^version:\s*"\K[^"]+' config.example.yaml | head -1)"
if [ -z "$VERSION" ]; then
  echo "错误: 无法从 config.example.yaml 解析版本号" >&2
  exit 1
fi

STAGE="dist/stage"
rm -rf "$STAGE" dist/CyberStrikeAI-Setup-*.exe
mkdir -p "$STAGE"

if [ "${1:-}" != "--no-build" ]; then
  echo "==> 构建桌面端（GUI + 控制台）"
  OUT="dist/stage/CyberStrikeAI-Desktop.exe" ./build-desktop.sh
  OUT="dist/stage/CyberStrikeAI-Desktop-console.exe" ./build-desktop.sh --console
fi

echo "==> 暂存运行资源"
for d in web agents skills roles tools mcp-servers plugins knowledge_base; do
  cp -r "$d" "$STAGE/"
done
cp config.example.yaml LICENSE "$STAGE/"
cp web/static/favicon.ico "$STAGE/favicon.ico"
# 剔除与安装无关的内容（源码仓里的示例与缓存）
find "$STAGE" -name ".DS_Store" -delete 2>/dev/null || true
rm -rf "$STAGE/web/static/js"/*.test.cjs

echo "==> 生成安装程序 (version=$VERSION)"
# makensis 的相对路径基于脚本所在目录解析，故 STAGE 传相对 installer/ 的路径
(cd installer && "$MAKENSIS" -INPUTCHARSET UTF8 -DVERSION="$VERSION" -DSTAGE="..\\dist\\stage" CyberStrikeAI.nsi)

echo "==> 完成"
ls -la dist/CyberStrikeAI-Setup-*.exe
