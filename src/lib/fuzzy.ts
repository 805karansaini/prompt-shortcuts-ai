import type { Shortcut } from './types';

function normalize(input: string): string {
    return input.toLowerCase();
}

function isWordBoundary(text: string, index: number): boolean {
    if (index <= 0) return true;
    const prev = text.charCodeAt(index - 1);
    const isAlphaNum = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    return !isAlphaNum(prev);
}

// Simple, fast subsequence scoring with adjacency and word-boundary bonuses.
// Returns 0 when query is not a subsequence of text; higher is better.
function subsequenceScore(text: string, query: string): number {
    let t = normalize(text);
    let q = normalize(query);
    if (!q) return 0;
    const qlen = q.length;

    // Avoid ultra-loose matching for very short queries
    if (qlen <= 2) return 0;

    let ti = 0;
    let qi = 0;
    let lastMatch = -1;
    let firstMatch = -1;
    let adjacencyBonus = 0;
    let boundaryBonus = 0;
    let totalGaps = 0;

    while (ti < t.length && qi < q.length) {
        if (t[ti] === q[qi]) {
            if (firstMatch === -1) firstMatch = ti;
            if (lastMatch !== -1) {
                const gap = ti - lastMatch - 1;
                if (gap === 0) adjacencyBonus += 12; // contiguous
                else totalGaps += gap;
            }
            if (isWordBoundary(t, ti)) boundaryBonus += 8;
            lastMatch = ti;
            qi++;
        }
        ti++;
    }

    if (qi < q.length) return 0; // not a subsequence

    const windowLen = lastMatch - firstMatch + 1;
    const density = qlen / Math.max(1, windowLen); // 0..1
    const numAdjacencies = Math.floor(adjacencyBonus / 12);
    // Thresholds scale with query length
    const minDensity = qlen <= 4 ? 0.66 : qlen <= 6 ? 0.6 : 0.55;
    const maxWindow = qlen + Math.max(2, Math.floor(qlen * 0.5));
    const hasBoundary = boundaryBonus >= 8;
    const hasAdjacency = numAdjacencies >= 1;

    // Tight filters to prevent extremely loose matches
    if (windowLen > maxWindow) return 0;
    if (density < minDensity) return 0;
    if (!hasBoundary && !hasAdjacency) return 0;
    if (totalGaps > qlen) return 0;

    // Base score rewards length of match; penalties for gaps; bonuses for contiguity and word starts
    const base = 400 + q.length * 5;
    const distancePenalty = Math.max(0, (lastMatch - firstMatch + 1) - q.length);
    const score = base + adjacencyBonus + boundaryBonus - distancePenalty - totalGaps * 0.5;
    return score;
}

// Combined text score using several heuristics. Higher is better; 0 means no match.
export function scoreText(text: string, query: string): number {
    const t = normalize(text);
    const q = normalize(query).trim();
    if (!q) return 0;

    if (t === q) return 1200 + q.length; // exact
    if (t.startsWith(q)) return 1000 + q.length; // prefix
    const idx = t.indexOf(q);
    if (idx >= 0) {
        // substring: reward earlier occurrences and boundaries
        const boundary = isWordBoundary(t, idx) ? 20 : 0;
        return 800 + boundary + Math.max(0, 20 - idx);
    }
    // subsequence (fuzzy)
    return subsequenceScore(t, q);
}

export function scoreShortcut(shortcut: Shortcut, query: string): number {
    // Heavier weight for alias matches; text is secondary
    const strictAliasScore = scoreText(shortcut.alias, query);
    const approxAlias = approxAliasScore(shortcut.alias, query);
    const aliasScore = Math.max(strictAliasScore, approxAlias) * 1.6;

    const strictTextScore = scoreText(shortcut.text, query);
    const approxText = approxTokenScore(shortcut.text, query);
    const textScore = Math.max(strictTextScore, approxText) * 1.0;
    const combined = Math.max(aliasScore, textScore);
    return combined > 0 ? combined : 0;
}

export function filterAndSortShortcuts(shortcuts: Shortcut[], query: string): Shortcut[] {
    const q = query.trim();
    if (!q) return shortcuts.slice();
    const scored = shortcuts.map((s) => ({ s, score: scoreShortcut(s, q) }));
    const filtered = scored.filter((x) => x.score > 0);
    filtered.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        // Stable fallback: enabled first, then by alias
        if (a.s.enabled !== b.s.enabled) return a.s.enabled ? -1 : 1;
        return a.s.alias.localeCompare(b.s.alias);
    });
    return filtered.map((x) => x.s);
}

// --- Typo tolerance helpers (bounded edit distance) ---

function allowedEditDistance(len: number): number {
    if (len <= 2) return 0;
    if (len <= 7) return 1;
    return 2;
}

function tokenize(text: string): string[] {
    const tokens = text.toLowerCase().match(/[a-z0-9]+/gi) || [];
    // Keep tokens with some substance to avoid noise
    return tokens.filter((tok) => tok.length >= 3);
}

function levenshteinWithin(a: string, b: string, maxDist: number): number {
    if (a === b) return 0;
    const alen = a.length;
    const blen = b.length;
    if (Math.abs(alen - blen) > maxDist) return maxDist + 1;
    // Ensure a is the shorter to reduce memory
    if (alen > blen) return levenshteinWithin(b, a, maxDist);
    const prev = new Array<number>(blen + 1);
    const curr = new Array<number>(blen + 1);
    for (let j = 0; j <= blen; j++) prev[j] = j;
    for (let i = 1; i <= alen; i++) {
        curr[0] = i;
        let rowMin = curr[0];
        const ai = a.charCodeAt(i - 1);
        for (let j = 1; j <= blen; j++) {
            const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
            const del = prev[j] + 1;
            const ins = curr[j - 1] + 1;
            const sub = prev[j - 1] + cost;
            let v = del < ins ? del : ins;
            if (sub < v) v = sub;
            curr[j] = v;
            if (v < rowMin) rowMin = v;
        }
        if (rowMin > maxDist) return maxDist + 1; // early exit
        // swap rows
        for (let j = 0; j <= blen; j++) prev[j] = curr[j];
    }
    return prev[blen];
}

function approxAliasScore(alias: string, query: string): number {
    const a = alias.toLowerCase();
    const q = query.toLowerCase().trim();
    const qlen = q.length;
    if (qlen <= 2) return 0;
    const maxDist = allowedEditDistance(qlen);
    const maxLenDiff = Math.max(2, Math.floor(qlen * 0.4));
    if (Math.abs(a.length - qlen) > maxLenDiff) return 0;
    const d = levenshteinWithin(a, q, maxDist);
    if (d > maxDist) return 0;
    // Score aliases aggressively when close
    return 920 - d * 80 + Math.min(20, Math.abs(a.length - qlen) === 0 ? 10 : 0);
}

function approxTokenScore(text: string, query: string): number {
    const q = query.toLowerCase().trim();
    const qlen = q.length;
    if (qlen <= 2) return 0;
    const tokens = tokenize(text);
    if (tokens.length === 0) return 0;
    const maxDist = allowedEditDistance(qlen);
    const maxLenDiff = Math.max(2, Math.floor(qlen * 0.4));
    let best = maxDist + 1;
    for (const tok of tokens) {
        if (Math.abs(tok.length - qlen) > maxLenDiff) continue;
        const d = levenshteinWithin(tok, q, maxDist);
        if (d < best) best = d;
        if (best === 0) break;
    }
    if (best > maxDist) return 0;
    // Token approx score lower than alias
    return 780 - best * 80;
}
