// Asset resolution for UNFOLDIQVideo frame components.
// Every asset resolves to a staticFile()-compatible path built from the
// Node branch's stagedPath (`unfoldiq/<pid>/<hash>/<file>`). Frame components
// perform no filesystem I/O: they only compute the public path.

import { staticFile } from 'remotion';
import type { AssetEntry, AssetsMap } from './types';

function assertSafeStagedPath(stagedPath: unknown, label: string): asserts stagedPath is string {
  if (typeof stagedPath !== 'string' || stagedPath.length === 0) {
    throw new Error(`RENDER_PROP_INVALID: ${label} has a missing stagedPath`);
  }
  if (stagedPath.startsWith('file://')) {
    throw new Error(`RENDER_PROP_INVALID: ${label} stagedPath must not use file:// URLs`);
  }
  if (stagedPath.includes('..')) {
    throw new Error(`RENDER_PROP_INVALID: ${label} stagedPath must not contain '..'`);
  }
  if (
    stagedPath.startsWith('/') ||
    stagedPath.startsWith('\\') ||
    /^[a-zA-Z]:[\\/]/.test(stagedPath)
  ) {
    throw new Error(`RENDER_PROP_INVALID: ${label} stagedPath must be relative, got absolute path`);
  }
}

export function resolveAssetEntry(
  asset: AssetEntry | undefined,
  _assets: AssetsMap,
  label: string,
): string {
  if (!asset) {
    throw new Error(`RENDER_PROP_INVALID: ${label} asset is missing`);
  }
  assertSafeStagedPath(asset.stagedPath, label);
  return staticFile(asset.stagedPath);
}

export function resolveImageAsset(
  asset: AssetEntry | undefined,
  assets: AssetsMap,
): string {
  if (!asset) {
    throw new Error('RENDER_PROP_INVALID: image asset is missing');
  }
  if (asset.type !== 'image') {
    throw new Error(
      `RENDER_PROP_INVALID: expected image asset but got type '${String(asset.type)}' for asset '${asset.assetId}'`,
    );
  }
  return resolveAssetEntry(asset, assets, `image asset '${asset.assetId}'`);
}

export function resolveVideoAsset(
  asset: AssetEntry | undefined,
  assets: AssetsMap,
): string {
  if (!asset) {
    throw new Error('RENDER_PROP_INVALID: video asset is missing');
  }
  if (asset.type !== 'video') {
    throw new Error(
      `RENDER_PROP_INVALID: expected video asset but got type '${String(asset.type)}' for asset '${asset.assetId}'`,
    );
  }
  return resolveAssetEntry(asset, assets, `video asset '${asset.assetId}'`);
}

export function resolveAudioAsset(
  asset: AssetEntry | undefined,
  assets: AssetsMap,
): string {
  if (!asset) {
    throw new Error('RENDER_PROP_INVALID: audio asset is missing');
  }
  if (asset.type !== 'audio') {
    throw new Error(
      `RENDER_PROP_INVALID: expected audio asset but got type '${String(asset.type)}' for asset '${asset.assetId}'`,
    );
  }
  return resolveAssetEntry(asset, assets, `audio asset '${asset.assetId}'`);
}

// Audio clips carry a `path` that is either an assetId present in the assets
// map or a stagedPath directly. Both resolve through the same safety checks.
export function resolveAudioPath(path: string, assets: AssetsMap): string {
  const entry = assets[path];
  if (entry) {
    return resolveAudioAsset(entry, assets);
  }
  assertSafeStagedPath(path, 'audio clip path');
  return staticFile(path);
}
