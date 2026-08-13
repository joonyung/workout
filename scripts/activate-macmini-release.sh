#!/bin/bash
set -euo pipefail

app_root="${1:?app root is required}"
release_id="${2:?release id is required}"
launch_agent_source="${3:?launch agent source is required}"
launch_agent_target="/Users/joonyung/Library/LaunchAgents/com.joonyung.workout.plist"
service_target="gui/$(id -u)/com.joonyung.workout"
release_path="${app_root}/releases/${release_id}"
current_path="${app_root}/current"

bootstrap_service() {
  for _ in 1 2 3 4 5; do
    if launchctl bootstrap "gui/$(id -u)" "$launch_agent_target"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

case "$app_root" in
  /Users/joonyung/Services/workout) ;;
  *) echo "Refusing unexpected app root: $app_root" >&2; exit 1 ;;
esac

test -f "${release_path}/dist/server/dev-server.js"
test -f "${release_path}/dist/index.html"
test -f "$launch_agent_source"

previous_target=""
if test -L "$current_path"; then
  previous_target="$(readlink "$current_path")"
fi

ln -sfn "$release_path" "$current_path"
cp "$launch_agent_source" "$launch_agent_target"
plutil -lint "$launch_agent_target"

launchctl bootout "$service_target" 2>/dev/null || true
bootstrap_service
launchctl kickstart -k "$service_target"

healthy="false"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if /usr/bin/curl --fail --silent --show-error http://127.0.0.1:5002/api/health >/dev/null; then
    healthy="true"
    break
  fi
  sleep 1
done

if test "$healthy" = "true"; then
  echo "Activated workout release ${release_id}."
  exit 0
fi

echo "Health check failed for ${release_id}." >&2
if test -n "$previous_target"; then
  echo "Rolling back to ${previous_target}." >&2
  ln -sfn "$previous_target" "$current_path"
  launchctl bootout "$service_target" 2>/dev/null || true
  bootstrap_service
  launchctl kickstart -k "$service_target"
fi
exit 1
