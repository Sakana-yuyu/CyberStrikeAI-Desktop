; CyberStrikeAI Windows 安装程序（NSIS v3.x）
; 由 build-installer.sh 调用：makensis -DVERSION=<ver> -DSTAGE=<staging dir> installer\CyberStrikeAI.nsi
; 相对路径均相对仓库根（makensis 的工作目录）解析。
;
; 设计要点：
;   - 按用户安装到 %LOCALAPPDATA%\CyberStrikeAI（免管理员权限；应用运行时会在安装目录
;     写 config.yaml/data/logs 等用户数据，LOCALAPPDATA 可写）
;   - 图标使用网页 favicon（web/static/favicon.ico），与 exe 内嵌图标同源
;   - 升级安装只覆盖程序资源，不动 config.yaml/data/ 等用户数据
;   - 卸载默认保留用户数据，勾选后才删除

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!ifndef VERSION
  !define VERSION "v1.7.19"
!endif
!ifndef STAGE
  !define STAGE "dist\stage"
!endif

!define APPNAME "CyberStrikeAI"
!define EXENAME "CyberStrikeAI-Desktop.exe"
!define PUBLISHER "CyberStrikeAI Project"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"

Unicode true
Name "${APPNAME} ${VERSION}"
OutFile "..\dist\CyberStrikeAI-Setup-${VERSION}-x64.exe"
InstallDir "$LOCALAPPDATA\${APPNAME}"
InstallDirRegKey HKCU "Software\${APPNAME}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING
!define MUI_ICON "${STAGE}\favicon.ico"
!define MUI_UNICON "${STAGE}\favicon.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXENAME}"
!define MUI_FINISHPAGE_RUN_TEXT "启动 CyberStrikeAI"
!define MUI_FINISHPAGE_TITLE_3LINES

!insertmacro MUI_PAGE_LICENSE "${STAGE}\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
UninstPage custom un.DeleteDataPage un.DeleteDataLeave
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Var DeleteDataCheckbox

Section "$(SecMainName)" SecMain
  SectionIn RO

  ; 升级安装时先优雅关闭正在运行的实例（WM_CLOSE，等价于用户关窗口）
  nsExec::Exec 'taskkill /IM ${EXENAME}'
  Sleep 2000

  SetOutPath "$INSTDIR"
  ; 程序资源（全部来自构建暂存目录，不含源码与用户数据）
  File "${STAGE}\${EXENAME}"
  File "${STAGE}\CyberStrikeAI-Desktop-console.exe"
  File "${STAGE}\config.example.yaml"
  File "${STAGE}\LICENSE"
  File /r "${STAGE}\web"
  File /r "${STAGE}\agents"
  File /r "${STAGE}\skills"
  File /r "${STAGE}\roles"
  File /r "${STAGE}\tools"
  File /r "${STAGE}\mcp-servers"
  File /r "${STAGE}\plugins"
  File /r "${STAGE}\knowledge_base"

  ; 开始菜单
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\${EXENAME}" 0
  CreateShortcut "$SMPROGRAMS\${APPNAME}\卸载 ${APPNAME}.lnk" "$INSTDIR\uninstall.exe" "" "$INSTDIR\uninstall.exe" 0

  ; 注册「应用与功能」条目
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\${APPNAME}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME} ${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\${EXENAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" "$\"$INSTDIR\uninstall.exe$\" /S"
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
SectionEnd

Section "$(SecDesktopName)" SecDesktop
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\${EXENAME}" 0
SectionEnd

; -- 卸载：程序与用户数据分开问 ----------------------------------------------

Function un.DeleteDataPage
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateCheckbox} 0 20u 100% 12u "$(UninstDeleteData)"
  Pop $DeleteDataCheckbox
  ${NSD_SetState} $DeleteDataCheckbox ${BST_UNCHECKED}
  ${NSD_CreateLabel} 0 44u 100% 40u "$(UninstDeleteDataHint)"
  Pop $0
  nsDialogs::Show
FunctionEnd

Function un.DeleteDataLeave
  ${NSD_GetState} $DeleteDataCheckbox $1
  StrCpy $DeleteDataCheckbox $1
FunctionEnd

LangString UninstDeleteData ${LANG_SIMPCHINESE} "同时删除用户数据（项目、对话、知识库与日志）"
LangString UninstDeleteData ${LANG_ENGLISH} "Also delete user data (projects, conversations, knowledge base and logs)"
LangString UninstDeleteDataHint ${LANG_SIMPCHINESE} "不勾选则仅卸载程序文件，保留 config.yaml、data/ 等用户数据，便于重装后继续使用。"
LangString UninstDeleteDataHint ${LANG_ENGLISH} "Leave unchecked to remove only program files, keeping config.yaml, data/ etc. for future reinstall."
LangString SecMainName ${LANG_SIMPCHINESE} "CyberStrikeAI 主程序"
LangString SecMainName ${LANG_ENGLISH} "CyberStrikeAI main program"
LangString SecDesktopName ${LANG_SIMPCHINESE} "桌面快捷方式"
LangString SecDesktopName ${LANG_ENGLISH} "Desktop shortcut"

Section "Uninstall"
  nsExec::Exec 'taskkill /IM ${EXENAME}'
  Sleep 2000

  Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\卸载 ${APPNAME}.lnk"
  RMDir "$SMPROGRAMS\${APPNAME}"
  Delete "$DESKTOP\${APPNAME}.lnk"

  Delete /REBOOTOK "$INSTDIR\${EXENAME}"
  Delete /REBOOTOK "$INSTDIR\CyberStrikeAI-Desktop-console.exe"
  Delete /REBOOTOK "$INSTDIR\config.example.yaml"
  Delete /REBOOTOK "$INSTDIR\LICENSE"
  Delete /REBOOTOK "$INSTDIR\uninstall.exe"
  RMDir /r /REBOOTOK "$INSTDIR\web"
  RMDir /r /REBOOTOK "$INSTDIR\agents"
  RMDir /r /REBOOTOK "$INSTDIR\skills"
  RMDir /r /REBOOTOK "$INSTDIR\roles"
  RMDir /r /REBOOTOK "$INSTDIR\tools"
  RMDir /r /REBOOTOK "$INSTDIR\mcp-servers"
  RMDir /r /REBOOTOK "$INSTDIR\plugins"

  ${If} $DeleteDataCheckbox = ${BST_CHECKED}
    RMDir /r "$INSTDIR\data"
    RMDir /r "$INSTDIR\logs"
    RMDir /r "$INSTDIR\log"
    RMDir /r "$INSTDIR\chat_uploads"
    RMDir /r "$INSTDIR\tmp"
    RMDir /r "$INSTDIR\knowledge_base"
    Delete "$INSTDIR\config.yaml"
  ${EndIf}

  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\${APPNAME}"
SectionEnd
