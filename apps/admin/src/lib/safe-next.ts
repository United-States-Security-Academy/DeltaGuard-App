/** A path on this site to return to: no other origins, no protocol-relative URLs. */
export function safeNext(value: unknown): string {
  return typeof value === 'string' && /^\/(?![/\\])[^\s]*$/.test(value) ? value : '/';
}
