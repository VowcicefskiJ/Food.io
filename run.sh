#!/usr/bin/env bash
# Food.io — one-command start for the web app (Mac / Linux)
#   ./run.sh
# Then open http://localhost:8000 in your browser.
set -e
cd "$(dirname "$0")"

# Load OPENAI_API_KEY from .env if present
if [ -f .env ]; then
  set -a; source .env; set +a
fi

if [ -z "$OPENAI_API_KEY" ]; then
  echo ""
  echo "  ✗ OPENAI_API_KEY is not set."
  echo "    Copy .env.example to .env and paste your key in it:"
  echo "      cp .env.example .env"
  echo ""
  exit 1
fi

# Create a virtualenv on first run
if [ ! -d .venv ]; then
  echo "First run — creating virtual environment..."
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt

echo ""
echo "  ✓ Food.io starting — open  http://localhost:8000  in your browser"
echo "    (Ctrl+C to stop)"
echo ""
uvicorn main:app --host 0.0.0.0 --port 8000
