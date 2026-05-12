#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
	cat <<'EOF'
Usage:
  scripts/release-mac-dmg.sh [patch|minor|major|<version>]

Examples:
  scripts/release-mac-dmg.sh
  scripts/release-mac-dmg.sh patch
  scripts/release-mac-dmg.sh minor
  scripts/release-mac-dmg.sh 0.2.1

Version commands:
  npm version patch --no-git-tag-version
  npm version minor --no-git-tag-version

Required environment:
  APPLE_ID
  APPLE_TEAM_ID
  APPLE_APP_SPECIFIC_PASSWORD
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
	usage
	exit 0
fi

for name in APPLE_ID APPLE_TEAM_ID APPLE_APP_SPECIFIC_PASSWORD; do
	if [[ -z "${!name:-}" ]]; then
		echo "Missing required environment variable: $name" >&2
		exit 1
	fi
done

if [[ -n "${1:-}" ]]; then
	case "$1" in
		patch | minor | major)
			npm version "$1" --no-git-tag-version
			;;
		*)
			npm version "$1" --no-git-tag-version
			;;
	esac
fi

APP_VERSION="$(node -p "require('./package.json').version")"
DMG_PATH="release/Pie-${APP_VERSION}-arm64.dmg"
IDENTITY="${CSC_NAME:-Developer ID Application: hongxia sun (9UXM7M6CX5)}"

echo "Building Pie ${APP_VERSION}"
echo "Output: ${DMG_PATH}"

rm -rf release

npm run desktop:build

npx electron-builder --mac dmg --publish never \
	-c.directories.output=release \
	-c.mac.notarize=false

codesign --sign "$IDENTITY" \
	--force \
	--timestamp \
	"$DMG_PATH"

xcrun notarytool submit "$DMG_PATH" \
	--apple-id "$APPLE_ID" \
	--password "$APPLE_APP_SPECIFIC_PASSWORD" \
	--team-id "$APPLE_TEAM_ID" \
	--wait \
	--timeout 45m

xcrun stapler staple "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"
hdiutil verify "$DMG_PATH"

echo "Done: ${ROOT_DIR}/${DMG_PATH}"
