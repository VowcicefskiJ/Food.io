@echo off
REM Food.io — one-command start for the web app (Windows)
REM   Double-click this file, or run:  run.bat
REM Then open http://localhost:8000 in your browser.
cd /d "%~dp0"

REM Load OPENAI_API_KEY from .env if present
if exist .env (
  for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do set "%%a=%%b"
)

if "%OPENAI_API_KEY%"=="" (
  echo.
  echo   X OPENAI_API_KEY is not set.
  echo     Copy .env.example to .env and paste your key in it.
  echo.
  pause
  exit /b 1
)

REM Create a virtualenv on first run
if not exist .venv (
  echo First run - creating virtual environment...
  python -m venv .venv
)
call .venv\Scripts\activate.bat
pip install -q -r requirements.txt

echo.
echo   Food.io starting - open  http://localhost:8000  in your browser
echo   (Ctrl+C to stop)
echo.
uvicorn main:app --host 0.0.0.0 --port 8000
