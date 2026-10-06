@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bildir.ps1" %*
exit /b %ERRORLEVEL%
