/**
 * Every string the agent sends must be well-formed UTF-16 (sync-api-v1 §1): a lone surrogate
 * makes the backend's JSON decode fail and would block the device's sync with a 422 forever.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Lone surrogates → U+FFFD. */
export function wellFormed(text: string): string {
  return text.replace(LONE_SURROGATE, '�');
}

/** Cuts to at most `max` UTF-16 code units without splitting a surrogate pair. */
export function truncateUnits(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}
