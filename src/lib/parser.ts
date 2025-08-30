import type { Shortcut } from './types';

// Match !alias that appears at start or after whitespace; capture the leading space
const TOKEN_RE = /(^|\s)(![a-z0-9-_]{2,24})\b/gi;
// Match escaped alias (!!alias) similarly
const UNESCAPE_RE = /(^|\s)!!([a-z0-9-_]{2,24})\b/gi;

export function replaceTokens(input: string, shortcuts: Shortcut[]): string {
  // Build case-insensitive alias map
  const map = new Map<string, Shortcut>();
  for (const s of shortcuts) if (s.enabled) map.set(s.alias.toLowerCase(), s);
  return replaceWithMap(input, map);
}

export function replaceWithMap(input: string, aliasMap: Map<string, Shortcut>): string {
  if (aliasMap.size === 0) return input;
  let out = input.replace(TOKEN_RE, (match, pre: string, token: string) => {
    const alias = token.slice(1).toLowerCase();
    const sc = aliasMap.get(alias);
    if (!sc) return match;
    return `${pre}${sc.text}`;
  });
  out = out.replace(UNESCAPE_RE, (_m, pre: string, a: string) => `${pre}!${a}`);
  return out;
}

export function extractAliases(input: string): string[] {
  const aliases: string[] = [];
  input.replace(TOKEN_RE, (_m, _pre: string, token: string) => {
    aliases.push(token.slice(1));
    return '';
  });
  return aliases;
}

export function isEscapedLiteral(segment: string): boolean {
  return /(^|\s)!!([a-z0-9-_]{2,24})\b/i.test(segment);
}
