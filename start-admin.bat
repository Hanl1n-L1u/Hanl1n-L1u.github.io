@echo off
rem 博客后台启动脚本
cd /d "%~dp0"
start "Blog Admin" cmd /k "node admin\admin.mjs 8765"
echo 后台已启动: http://localhost:8765
start http://localhost:8765
