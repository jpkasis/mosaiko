/**
 * Greedy word-aware wrap to a fixed char budget per line, limited by maxLines.
 * If content overflows maxLines, the final line keeps the tail (parent overflow
 * is responsible for clipping visually). Splits on the last whitespace inside
 * the budget; falls back to a hard break if no whitespace exists.
 */
export function wrapByBudget(text: string, budget: number, maxLines: number): string[] {
  const t = text.trim();
  if (!t) return [];
  const words = t.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= budget) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      if (lines.length === maxLines) {
        return lines;
      }
      current = word;
    } else {
      // Single word longer than budget — hard break.
      let remaining = word;
      while (remaining.length > budget) {
        lines.push(remaining.slice(0, budget));
        if (lines.length === maxLines) {
          return lines;
        }
        remaining = remaining.slice(budget);
      }
      current = remaining;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.slice(0, maxLines);
}

export function wrapTitle(title: string, budget = 12, maxLines = 3): string[] {
  return wrapByBudget(title.toUpperCase(), budget, maxLines);
}

export function wrapArtist(line: string, budget = 28, maxLines = 2): string[] {
  return wrapByBudget(line, budget, maxLines);
}
