/** `vx-asset://library/<path>` for a library-relative path (SPECS 3.3). */
export function assetUrl(path: string, version?: number | string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `vx-asset://library/${encoded}${version !== undefined ? `?v=${encodeURIComponent(String(version))}` : ''}`;
}
