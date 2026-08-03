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

echo "Rasterizing PWA icons from icon.png (192/512/maskable-512/apple-touch-icon)..."
node -e "
const sharp = require('sharp');
const BG = '#f5efe3'; // matches --bg in src/styles/variables.css (light theme)

async function main() {
  await sharp('$BUILD_DIR/icon.png').resize(192, 192).png().toFile('public/pwa-icon-192.png');
  await sharp('$BUILD_DIR/icon.png').resize(512, 512).png().toFile('public/pwa-icon-512.png');

  // Maskable: OS-applied shape masks (circle, squircle, rounded square) can crop right up to the
  // canvas edge, so maskable content must live inside the center ~80% 'safe zone'. Composited onto
  // a solid background (transparent maskable icons render as a black hole on some launchers) at a
  // conservative 65% scale, well inside that zone.
  const inner512 = Math.round(512 * 0.65);
  const bottle512 = await sharp('$BUILD_DIR/icon.png').resize(inner512, inner512).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: BG } })
    .composite([{ input: bottle512, gravity: 'center' }])
    .png()
    .toFile('public/pwa-icon-maskable-512.png');

  // iOS never applies its own background to apple-touch-icon — a transparent one renders as a
  // black square on the home screen, so this also gets composited onto the solid brand background.
  const inner180 = Math.round(180 * 0.72);
  const bottle180 = await sharp('$BUILD_DIR/icon.png').resize(inner180, inner180).png().toBuffer();
  await sharp({ create: { width: 180, height: 180, channels: 4, background: BG } })
    .composite([{ input: bottle180, gravity: 'center' }])
    .png()
    .toFile('public/apple-touch-icon.png');
}
main().then(() => console.log('wrote public/pwa-icon-192.png, pwa-icon-512.png, pwa-icon-maskable-512.png, apple-touch-icon.png'));
"

echo "Done. Wrote build/icon.png, build/icon.icns, build/trayTemplate.png(@2x), public/favicon.svg, public/pwa-icon-*.png, public/apple-touch-icon.png"
