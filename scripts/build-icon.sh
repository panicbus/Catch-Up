#!/usr/bin/env bash
# Rasterizes build/icon-source.svg into the app icon set (mac .icns + dock/tray PNGs)
# and copies a favicon into public/. Requires: node (with `sharp` installed), sips, iconutil.
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD_DIR="build"
ICONSET_DIR="$BUILD_DIR/icon.iconset"

echo "Rasterizing icon-source.svg -> icon.png (1024x1024)..."
node -e "
const sharp = require('sharp');
sharp('$BUILD_DIR/icon-source.svg', { density: 384 })
  .resize(1024, 1024)
  .png()
  .toFile('$BUILD_DIR/icon.png')
  .then(() => console.log('wrote $BUILD_DIR/icon.png'));
"

echo "Rasterizing icon-tray-source.svg -> trayTemplate.png (22x22 @1x/@2x)..."
node -e "
const sharp = require('sharp');
Promise.all([
  sharp('$BUILD_DIR/icon-tray-source.svg', { density: 384 }).resize(22, 22).png().toFile('$BUILD_DIR/trayTemplate.png'),
  sharp('$BUILD_DIR/icon-tray-source.svg', { density: 384 }).resize(44, 44).png().toFile('$BUILD_DIR/trayTemplate@2x.png'),
]).then(() => console.log('wrote trayTemplate.png (+@2x)'));
"

echo "Building .iconset..."
rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$BUILD_DIR/icon.png" --out "$ICONSET_DIR/icon_${size}x${size}.png" > /dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$BUILD_DIR/icon.png" --out "$ICONSET_DIR/icon_${size}x${size}@2x.png" > /dev/null
done

echo "Building icon.icns..."
iconutil -c icns "$ICONSET_DIR" -o "$BUILD_DIR/icon.icns"
rm -rf "$ICONSET_DIR"

echo "Copying favicon..."
cp "$BUILD_DIR/icon-source.svg" public/favicon.svg

echo "Done. Wrote build/icon.png, build/icon.icns, build/trayTemplate.png(@2x), public/favicon.svg"
