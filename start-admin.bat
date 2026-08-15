@echo off
rem 博客后台启动脚本
cd /d "%~dp0"
start "Blog Admin" cmd /k "node admin\admin.mjs 8888"
echo 后台已启动: http://localhost:8888
start http://localhost:8888
