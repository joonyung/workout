#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
watch_root="$project_root/apple/WorkoutWatch"

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "XcodeGen is required. Install it with: brew install xcodegen" >&2
  exit 1
fi

xcodegen generate --spec "$watch_root/project.yml" --project "$watch_root"
echo "Generated $watch_root/WorkoutWatch.xcodeproj"
