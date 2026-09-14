#!/usr/bin/env bash
set -Eeuo pipefail

TAG="${1:-}"
if [[ -z "$TAG" ]]; then
  echo "Usage: ./rollback.sh <tag>"
  exit 1
fi

APP_HOME="${APP_HOME:-/home/admin/apps/lycoris-backend}"
RELEASES_DIR="${RELEASES_DIR:-$APP_HOME/releases}"
CURRENT_LINK="${CURRENT_LINK:-$APP_HOME/current}"
SERVICE_NAME="${SERVICE_NAME:-lycoris-backend}"

if [[ ! -d "$RELEASES_DIR" ]]; then
  echo "Releases directory not found: $RELEASES_DIR"
  exit 1
fi

TARGET_RELEASE="$(ls -dt "$RELEASES_DIR/$TAG" "$RELEASES_DIR/$TAG"-* 2>/dev/null | head -n 1 || true)"
if [[ -z "$TARGET_RELEASE" || ! -d "$TARGET_RELEASE" ]]; then
  echo "No release found for tag: $TAG"
  echo "Available releases:"
  ls -1 "$RELEASES_DIR" || true
  exit 1
fi

PREVIOUS_RELEASE=""
if [[ -L "$CURRENT_LINK" ]]; then
  PREVIOUS_RELEASE="$(readlink -f "$CURRENT_LINK" || true)"
fi

echo "[rollback] switching current -> $TARGET_RELEASE"
ln -sfn "$TARGET_RELEASE" "$CURRENT_LINK"

echo "[rollback] restarting service: $SERVICE_NAME"
if ! sudo systemctl restart "$SERVICE_NAME"; then
  if [[ -n "$PREVIOUS_RELEASE" ]]; then
    echo "[rollback] restart failed, restoring previous release: $PREVIOUS_RELEASE"
    ln -sfn "$PREVIOUS_RELEASE" "$CURRENT_LINK"
    sudo systemctl restart "$SERVICE_NAME" || true
  fi
  exit 1
fi

sudo systemctl --no-pager --full status "$SERVICE_NAME" | sed -n '1,20p'
echo "[rollback] done"
