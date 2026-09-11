@echo off
setlocal
if not exist "%~dp0current.cmd" (
  echo {"ok":false,"stage":"launcher_validation","code":"installation_incomplete","retryable":true,"suggestedAction":"run_install_cmd_repair","backupPath":null,"detail":"current.cmd is missing"} 1>&2
  exit /b 1
)
call "%~dp0current.cmd" %*
exit /b %ERRORLEVEL%
