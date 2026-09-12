#!/usr/bin/env bash
#
# Sets this up on the machine where the Obsidian vault lives.
#
#   ./install.sh                 interactive: config, dependencies, a check
#   ./install.sh --schedule      also install the launchd job (macOS)
#
# Nothing here is destructive. An existing config is never overwritten without
# being asked, and the launchd job is only installed when explicitly requested.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${HOME}/.config/pocket-todoist"
CONFIG_FILE="${CONFIG_DIR}/config.json"
VENV="${HERE}/.venv"
LOG_DIR="${HOME}/Library/Logs"
SCHEDULE=0
[[ "${1:-}" == "--schedule" ]] && SCHEDULE=1

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ask() { local prompt="$1" default="${2:-}" answer; read -r -p "$prompt${default:+ [$default]}: " answer; echo "${answer:-$default}"; }

say "1. Python"
PYTHON="$(command -v python3 || true)"
if [[ -z "$PYTHON" ]]; then
  echo "python3 not found. Install it (brew install python) and run this again." >&2
  exit 1
fi
echo "   $($PYTHON --version) at $PYTHON"

say "2. Dependencies"
# A virtualenv beside the code, so this never fights with anything else on the
# machine and can be deleted by deleting one folder.
if [[ ! -d "$VENV" ]]; then
  "$PYTHON" -m venv "$VENV"
fi
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet anthropic
echo "   anthropic installed into .venv"

say "3. Configuration"
if [[ -f "$CONFIG_FILE" ]]; then
  echo "   $CONFIG_FILE already exists -- leaving it alone."
else
  mkdir -p "$CONFIG_DIR"
  VAULT_PATH="$(ask '   Full path to your Obsidian vault' "${HOME}/Second Brain")"
  VAULT_NAME="$(ask '   Vault name as Obsidian shows it' "$(basename "$VAULT_PATH")")"
  POCKET_FOLDER="$(ask '   Folder inside the vault where Pocket notes land' 'Pocket')"
  TIMEZONE="$(ask '   Your timezone' 'Australia/Brisbane')"

  "$VENV/bin/python" - "$HERE/config.example.json" "$CONFIG_FILE" \
      "$VAULT_PATH" "$VAULT_NAME" "$POCKET_FOLDER" "$TIMEZONE" <<'PY'
import json, sys
source, target, path, name, folder, tz = sys.argv[1:7]
with open(source) as handle:
    config = json.load(handle)
config.pop("_comment", None)
config["timezone"] = tz
config["vault"]["path"] = path
config["vault"]["name"] = name
config["vault"]["include_folders"] = [folder]
with open(target, "w") as handle:
    json.dump(config, handle, indent=2)
    handle.write("\n")
PY
  echo "   wrote $CONFIG_FILE"
fi

say "4. API tokens"
# Read from the environment so they never end up in the config file, which is
# the thing most likely to get copied around or synced by accident.
if [[ -z "${TODOIST_API_TOKEN:-}" ]]; then
  echo "   TODOIST_API_TOKEN is not set."
  echo "   Get it from Todoist -> Settings -> Integrations -> Developer, then add"
  echo "   to ~/.zshrc:   export TODOIST_API_TOKEN=..."
fi
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "   ANTHROPIC_API_KEY is not set."
  echo "   Get it from console.anthropic.com, then add to ~/.zshrc:"
  echo "                  export ANTHROPIC_API_KEY=..."
fi

say "5. Check"
"$VENV/bin/python" "$HERE/run.py" --doctor || true

if [[ "$SCHEDULE" == "1" ]]; then
  say "6. Schedule (launchd, every 15 minutes)"
  if [[ "$(uname)" != "Darwin" ]]; then
    echo "   Not macOS -- use cron instead:"
    echo "   */15 * * * * $VENV/bin/python $HERE/run.py --once >> /tmp/pocket-todoist.log 2>&1"
  else
    mkdir -p "$LOG_DIR" "${HOME}/Library/LaunchAgents"
    PLIST="${HOME}/Library/LaunchAgents/com.pocket-todoist.plist"
    sed -e "s|__PYTHON__|${VENV}/bin/python|g" \
        -e "s|__RUNPY__|${HERE}/run.py|g" \
        -e "s|__LOGDIR__|${LOG_DIR}|g" \
        -e "s|__TODOIST_TOKEN__|${TODOIST_API_TOKEN:-}|g" \
        -e "s|__ANTHROPIC_KEY__|${ANTHROPIC_API_KEY:-}|g" \
        "$HERE/com.pocket-todoist.plist.template" > "$PLIST"
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST"
    echo "   loaded $PLIST"
    echo "   logs: $LOG_DIR/pocket-todoist.log"
    echo "   stop with: launchctl unload $PLIST"
  fi
fi

say "Done."
echo "Try it without changing anything:"
echo "  $VENV/bin/python $HERE/run.py --once --dry-run"
