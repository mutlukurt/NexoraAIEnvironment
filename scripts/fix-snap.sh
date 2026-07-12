#!/bin/bash
# ---------------------------------------------------------------------------
# fix-snap.sh — repair electron-builder's broken snap output.
#
# electron-builder v26 cannot produce a working snap on Ubuntu 26.04 + snapcraft 9:
#   * template path  -> fails to extract the snap template, leaving a stray .tar and
#                       MISSING the NSS/NSPR runtime libs + desktop launcher scripts
#                       (app crashes on 2nd launch: "libnspr4.so: cannot open ...").
#   * no-template path -> calls the removed `snapcraft snap` command (renamed to `pack`).
#
# So we let electron-builder produce its (broken) snap for the correct meta/snap.yaml +
# app payload, then repair it here and repack with `snapcraft pack` (no LXD needed).
#
# Usage: bash scripts/fix-snap.sh [path-to.snap]   (default: newest release/*.snap)
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

SNAP_FILE="${1:-$(ls -t release/*.snap 2>/dev/null | head -1)}"
[ -z "${SNAP_FILE:-}" ] || [ ! -f "$SNAP_FILE" ] && { echo "ERROR: snap file not found ($SNAP_FILE)"; exit 1; }
SNAP_FILE="$(realpath "$SNAP_FILE")"
TPL_DIR="node_modules/app-builder-lib/templates/snap"

# The electron-builder snap template tar carries the NSS/NSPR runtime libs + gnome-platform
# mount dirs that Chromium/Electron needs. electron-builder downloads it here but fails to
# unpack it into the snap; we extract it ourselves.
TPL_TAR="$(find "$HOME/.cache/electron-builder" -name 'snap-template-electron-*-amd64.tar' 2>/dev/null | head -1)"
[ -z "$TPL_TAR" ] && { echo "ERROR: snap template tar not found — run 'electron-builder --linux snap' once first"; exit 1; }

WORK="$(mktemp -d)"; ROOT="$WORK/squashfs-root"
trap 'rm -rf "$WORK"' EXIT

echo "→ unsquashing $SNAP_FILE"
unsquashfs -q -d "$ROOT" "$SNAP_FILE"

echo "→ removing stray template tar (the electron-builder bug)"
rm -f "$ROOT"/snap-template-electron-*-amd64.tar

echo "→ extracting template runtime libs + gnome-platform/data-dir mount points"
tar xf "$TPL_TAR" -C "$ROOT"

echo "→ installing current desktop launcher scripts"
for s in desktop-init.sh desktop-common.sh desktop-gnome-specific.sh; do
  cp "$TPL_DIR/$s" "$ROOT/$s"; chmod 755 "$ROOT/$s"
done

echo "→ patching command.sh: force X11 (XWayland) + software rendering for reliable launch"
# NexoraAI's GPU work runs in the llama-server subprocess (Vulkan), NOT Electron's renderer,
# so disabling Electron GPU + forcing X11 fixes the Wayland/MESA launch crash with no loss.
cat > "$ROOT/command.sh" <<'CMD'
#!/bin/bash -e
export ELECTRON_OZONE_PLATFORM_HINT=x11
exec "$SNAP/desktop-init.sh" "$SNAP/desktop-common.sh" "$SNAP/desktop-gnome-specific.sh" "$SNAP/nexora-ai" '--no-sandbox' '--ozone-platform=x11' '--disable-gpu' "$@"
CMD
chmod 755 "$ROOT/command.sh"

echo "→ repacking with snapcraft pack (no LXD)"
SNAPCRAFT_HAS_TTY=false snapcraft pack "$ROOT" --output "$SNAP_FILE"

echo "✓ repaired snap: $SNAP_FILE"
