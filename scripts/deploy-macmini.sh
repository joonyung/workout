#!/bin/bash
set -euo pipefail

remote_host="${MACMINI_HOST:-macmini}"
app_root="${MACMINI_APP_ROOT:-/Users/joonyung/Services/workout}"
state_root="${MACMINI_STATE_ROOT:-/Users/joonyung/Projects/workout/state}"
node_path="${MACMINI_NODE_PATH:-/opt/homebrew/bin/node}"
release_id="$(date -u +%Y%m%dT%H%M%SZ)"
remote_staging="/private/tmp/workout-${release_id}"
temporary_directory="$(mktemp -d)"

cleanup() {
  rm -rf "$temporary_directory"
}
trap cleanup EXIT

case "$app_root" in
  /Users/joonyung/Services/workout) ;;
  *) echo "Refusing unexpected app root: $app_root" >&2; exit 1 ;;
esac

case "$state_root" in
  /Users/joonyung/Projects/workout/state) ;;
  *) echo "Refusing unexpected state root: $state_root" >&2; exit 1 ;;
esac

echo "Validating local release..."
npm run typecheck
npm test
npm run build

release_archive="${temporary_directory}/release.tgz"
launch_agent="${temporary_directory}/com.joonyung.workout.plist"

tar -czf "$release_archive" \
  dist \
  scripts/activate-macmini-release.sh
sed \
  -e "s|__APP_ROOT__|${app_root}|g" \
  -e "s|__STATE_ROOT__|${state_root}|g" \
  -e "s|__NODE_PATH__|${node_path}|g" \
  deploy/com.joonyung.workout.plist.template > "$launch_agent"
plutil -lint "$launch_agent"

echo "Preparing ${remote_host}:${app_root}..."
ssh "$remote_host" \
  "test -x '${node_path}' && \
   test -f '${state_root}/data/profile.json' && \
   mkdir -p '${app_root}/releases/${release_id}' '${app_root}/logs' '${remote_staging}'"

scp "$release_archive" "$launch_agent" \
  "${remote_host}:${remote_staging}/"

ssh "$remote_host" \
  "tar -xzf '${remote_staging}/release.tgz' -C '${app_root}/releases/${release_id}' && \
   '${node_path}' --check '${app_root}/releases/${release_id}/dist/server/dev-server.js' && \
   WORKOUT_STATE_ROOT='${state_root}' \
     '${node_path}' '${app_root}/releases/${release_id}/dist/server/validate-data.js' && \
   /bin/bash '${app_root}/releases/${release_id}/scripts/activate-macmini-release.sh' \
     '${app_root}' '${release_id}' '${remote_staging}/com.joonyung.workout.plist'"

ssh "$remote_host" "rm -rf '${remote_staging}'"

echo "Deployment complete: ${release_id}"
echo "Local health: ssh ${remote_host} curl http://127.0.0.1:5002/api/health"
