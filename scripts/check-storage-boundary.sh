#!/usr/bin/env bash
# Module 04 acceptance — nothing outside the storage boundary knows the provider.
#
# lib/storage.ts is the server half, lib/storage.client.ts the browser half (the
# signed upload has to run in the browser, or image bytes would cross a function).
# Those two files are the entire cost of the Cloudflare R2 migration at ~900
# accounts. A third file learning the provider is what turns that into a project.
set -euo pipefail

hits=$(grep -rn "\.storage\b" --include='*.ts' --include='*.tsx' app lib components 2>/dev/null \
  | grep -v '^lib/storage\.ts:' \
  | grep -v '^lib/storage\.client\.ts:' \
  | grep -vE 'storage_path|storagePath' || true)

if [ -n "$hits" ]; then
  echo "$hits"
  echo
  echo "FAIL: storage client used outside lib/storage.ts and lib/storage.client.ts."
  exit 1
fi

echo "OK: storage provider is known to two files only"
