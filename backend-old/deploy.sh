#!/usr/bin/env bash
set -Eeuo pipefail

TAG="${1:-}"
if [[ -z "$TAG" ]]; then
  echo "Usage: ./deploy.sh <tag>"
  exit 1
fi

APP_HOME="${APP_HOME:-/home/admin/apps/lycoris-backend}"
RELEASES_DIR="${RELEASES_DIR:-$APP_HOME/releases}"
CURRENT_LINK="${CURRENT_LINK:-$APP_HOME/current}"
SERVICE_NAME="${SERVICE_NAME:-lycoris-backend}"
MVN_CMD="${MVN_CMD:-./mvnw}"

if ! command -v git >/dev/null 2>&1; then
  echo "git not found"
  exit 1
fi

if [[ ! -d .git ]]; then
  echo "Please run this script in backend git repository root."
  exit 1
fi

PREVIOUS_RELEASE=""
if [[ -L "$CURRENT_LINK" ]]; then
  PREVIOUS_RELEASE="$(readlink -f "$CURRENT_LINK" || true)"
fi

ROLLBACK_NEEDED=0
rollback_on_error() {
  if [[ "$ROLLBACK_NEEDED" -eq 1 && -n "$PREVIOUS_RELEASE" ]]; then
    echo "[rollback] restoring previous release: $PREVIOUS_RELEASE"
    ln -sfn "$PREVIOUS_RELEASE" "$CURRENT_LINK"
    sudo systemctl restart "$SERVICE_NAME" || true
  fi
}
trap rollback_on_error ERR

echo "[deploy] fetching tags"
git fetch --tags --quiet || true

if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "Tag '$TAG' not found locally."
  exit 1
fi

echo "[deploy] checking out tag: $TAG"
git checkout -f "tags/$TAG"

echo "[deploy] building jar"
"$MVN_CMD" -DskipTests clean package

JAR_PATH="$(find target -maxdepth 1 -type f -name '*.jar' ! -name '*.original' | head -n 1)"
if [[ -z "$JAR_PATH" ]]; then
  echo "No runnable jar found under target/"
  exit 1
fi

RELEASE_NAME="${TAG}-$(date +%Y%m%d%H%M%S)"
RELEASE_PATH="$RELEASES_DIR/$RELEASE_NAME"

echo "[deploy] creating release: $RELEASE_PATH"
mkdir -p "$RELEASE_PATH"
cp "$JAR_PATH" "$RELEASE_PATH/app.jar"

ROLLBACK_NEEDED=1
ln -sfn "$RELEASE_PATH" "$CURRENT_LINK"

echo "[deploy] restarting service: $SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl --no-pager --full status "$SERVICE_NAME" | sed -n '1,20p'

echo "[deploy] smoke check"
HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/me || true)"
if [[ "$HTTP_CODE" != "200" && "$HTTP_CODE" != "401" && "$HTTP_CODE" != "403" ]]; then
  echo "Unexpected health code from /api/me: $HTTP_CODE"
  exit 1
fi

ROLLBACK_NEEDED=0
echo "[deploy] success -> $RELEASE_NAME (http $HTTP_CODE)"
