#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
# AlignPulse - Termux Android Quick Setup & Launch Script
# ==============================================================================
echo "=========================================="
echo " AlignPulse - Audio Forced Alignment Setup"
echo "=========================================="

CURRENT_DIR=$(pwd)
if [[ "$CURRENT_DIR" == *"/storage/"* ]] || [[ "$CURRENT_DIR" == *"/sdcard/"* ]]; then
  echo ""
  echo "⚠️  WARNING: You are running inside shared Android storage ($CURRENT_DIR)!"
  echo "Android blocks binary execution (noexec) in /sdcard."
  echo "Moving to Termux Home directory (~/alignpulse)..."
  mkdir -p "$HOME/alignpulse"
  cp -r ./* "$HOME/alignpulse/"
  cd "$HOME/alignpulse" || exit 1
  echo "✅ Copied to $HOME/alignpulse"
fi

if ! command -v node &> /dev/null; then
  echo "📦 Installing Node.js..."
  pkg update -y && pkg install nodejs -y
fi

if [ -d "node_modules/.bin" ]; then
  chmod +x node_modules/.bin/* 2>/dev/null
fi

if [ ! -d "node_modules" ]; then
  echo "📦 Installing npm packages..."
  npm install
fi

if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    echo "⚙️ Created .env file from .env.example. Please add your GEMINI_API_KEY if needed."
  fi
fi

echo ""
echo "🚀 Starting AlignPulse Server on Port 3000..."
echo "Open your browser at: http://localhost:3000"
echo "=========================================="
node --import tsx server.ts
