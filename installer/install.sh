#!/usr/bin/env bash
# Ubuntu / Linux / macOS installer for Myfactory V1.0.
# Never closes, restarts, or terminates Antigravity IDE or Cursor IDE.
set -euo pipefail

SCOPE="global"
PROJECT_PATH=""
UPDATE_FACTORY=0
OFFLINE=0
SKIP_EXTERNAL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --scope) SCOPE="$2"; shift 2 ;;
    --project) PROJECT_PATH="$2"; shift 2 ;;
    --update) UPDATE_FACTORY=1; shift ;;
    --offline) OFFLINE=1; SKIP_EXTERNAL=1; shift ;;
    --skip-external) SKIP_EXTERNAL=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
USER_ROOT="${FACTORY_TEST_USERPROFILE:-$HOME}"
DATA_HOME="${FACTORY_GLOBAL_HOME:-$USER_ROOT/.gemini/factory}"
FACTORY_HOME="$USER_ROOT/.gemini/factory-home"

copy_missing_or_update() {
  local src="$1" dst="$2" overwrite="$3"
  [ -d "$src" ] || return 0
  mkdir -p "$dst"
  if [ "$overwrite" = "1" ]; then
    cp -R "$src"/. "$dst"/
  else
    while IFS= read -r -d '' f; do
      local rel="${f#$src/}"
      local out="$dst/$rel"
      if [ ! -e "$out" ]; then
        mkdir -p "$(dirname "$out")"
        cp "$f" "$out"
      fi
    done < <(find "$src" -type f -print0)
  fi
}

if [ "$SCOPE" = "global" ] || [ "$SCOPE" = "both" ]; then
  copy_missing_or_update "$SOURCE_DIR/.agents/skills" "$USER_ROOT/.gemini/config/skills" "$UPDATE_FACTORY"
  copy_missing_or_update "$SOURCE_DIR/.agents/rules" "$USER_ROOT/.gemini/config/rules" "$UPDATE_FACTORY"
  copy_missing_or_update "$SOURCE_DIR/.agents/agents" "$USER_ROOT/.gemini/config/agents" "$UPDATE_FACTORY"
  copy_missing_or_update "$SOURCE_DIR/.agents/workflows" "$USER_ROOT/.gemini/workflows" "$UPDATE_FACTORY"
  copy_missing_or_update "$SOURCE_DIR/.agents/workflows" "$USER_ROOT/.agents/workflows" "$UPDATE_FACTORY"

  # Cursor global setup (never modifies ~/.cursor/skills-cursor)
  copy_missing_or_update "$SOURCE_DIR/.agents/skills" "$USER_ROOT/.cursor/skills" "$UPDATE_FACTORY"
  copy_missing_or_update "$SOURCE_DIR/.cursor/rules" "$USER_ROOT/.cursor/rules" "$UPDATE_FACTORY"
  copy_missing_or_update "$SOURCE_DIR/.cursor/agents" "$USER_ROOT/.cursor/agents" "$UPDATE_FACTORY"

  if [ -d "$FACTORY_HOME" ] && [ "$UPDATE_FACTORY" = "1" ]; then
    BAK_DIR="$DATA_HOME/backups/install-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BAK_DIR"
    cp -R "$FACTORY_HOME/bin" "$FACTORY_HOME/src" "$FACTORY_HOME/package.json" "$BAK_DIR/" 2>/dev/null || true
    echo "Backed up previous factory-home to $BAK_DIR"
  fi

  mkdir -p "$FACTORY_HOME" "$DATA_HOME/memory" "$USER_ROOT/.local/bin"
  for d in bin src .agents .agent .cursor installer; do
    if [ -d "$SOURCE_DIR/$d" ]; then
      rm -rf "$FACTORY_HOME/$d"
      cp -R "$SOURCE_DIR/$d" "$FACTORY_HOME/$d"
    fi
  done
  cp "$SOURCE_DIR/package.json" "$FACTORY_HOME/package.json"

  cat > "$USER_ROOT/.local/bin/factory" <<'SH'
#!/usr/bin/env sh
exec node "$HOME/.gemini/factory-home/bin/factory.mjs" "$@"
SH
  chmod +x "$USER_ROOT/.local/bin/factory"
  echo "Installed global CLI runtime at $FACTORY_HOME and shim at $USER_ROOT/.local/bin/factory"
fi

if [ "$SCOPE" = "workspace" ] || [ "$SCOPE" = "both" ]; then
  TARGET="${PROJECT_PATH:-$(pwd)}"
  if command -v node >/dev/null 2>&1; then
    if [ "$OFFLINE" = "1" ]; then
      node "$SOURCE_DIR/bin/factory.mjs" init "$TARGET" --skip-external --offline >/dev/null
    else
      node "$SOURCE_DIR/bin/factory.mjs" init "$TARGET" --skip-external >/dev/null
    fi
  fi
fi

if [ "$SKIP_EXTERNAL" = "0" ] && command -v git >/dev/null 2>&1; then
  for pair in \
    "https://github.com/backnotprop/pstack.git|poteto-mode" \
    "https://github.com/DietrichGebert/ponytail.git|ponytail"
  do
    repo="${pair%|*}"
    check="${pair#*|}"
    if [ ! -f "$USER_ROOT/.gemini/config/skills/$check/SKILL.md" ] || [ ! -f "$USER_ROOT/.cursor/skills/$check/SKILL.md" ]; then
      tmp="$(mktemp -d)"
      if git clone --quiet --depth 1 "$repo" "$tmp" 2>/dev/null; then
        if [ -d "$tmp/skills" ]; then
          for sk in "$tmp/skills"/*; do
            [ -f "$sk/SKILL.md" ] || continue
            name="$(basename "$sk")"
            copy_missing_or_update "$sk" "$USER_ROOT/.gemini/config/skills/$name" "0"
            copy_missing_or_update "$sk" "$USER_ROOT/.cursor/skills/$name" "0"
          done
        fi
        if [ -d "$tmp/agents" ]; then
          mkdir -p "$USER_ROOT/.cursor/agents"
          for af in "$tmp/agents"/*.md; do
            [ -f "$af" ] || continue
            aname="$(basename "$af")"
            [ -e "$USER_ROOT/.cursor/agents/$aname" ] || cp "$af" "$USER_ROOT/.cursor/agents/$aname"
          done
        fi
      fi
      rm -rf "$tmp"
    fi
  done
fi

if command -v node >/dev/null 2>&1; then
  FACTORY_GLOBAL_HOME="$DATA_HOME" node "$FACTORY_HOME/bin/factory.mjs" doctor "${PROJECT_PATH:-$SOURCE_DIR}" >/dev/null || true
fi

echo "Installation complete (scope=$SCOPE). Antigravity IDE and Cursor IDE were not restarted."
