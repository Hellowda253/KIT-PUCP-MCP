@echo off
setlocal
set "PUCP_PORTABLE_ROOT=%~dp0."
set "PUCP_PORTABLE_NODE="
for /d %%D in ("%PUCP_PORTABLE_ROOT%\runtime\node-v*-win-x64") do (
  if exist "%%~fD\node.exe" set "PUCP_PORTABLE_NODE=%%~fD\node.exe"
)
if not defined PUCP_PORTABLE_NODE (
  echo {"ok":false,"stage":"runtime_discovery","code":"installation_incomplete","retryable":true,"suggestedAction":"download_the_portable_release_again","backupPath":null,"detail":"Bundled Node.js runtime was not found"} 1>&2
  exit /b 1
)
"%PUCP_PORTABLE_NODE%" "%PUCP_PORTABLE_ROOT%\scripts\portable-installer.mjs" %* --artifact-root "%PUCP_PORTABLE_ROOT%"
exit /b %ERRORLEVEL%
