/**
 * House rules reach a resumed conversation (owner, 2026-10-11).
 *
 * The rules ride in each agent's start instructions, but the app resumes every
 * agent's old conversation, and an agent follows its own recent example over a
 * quiet new line (seen live: Nick had rule 7 and still copied the Sources list
 * of the report he was asked to extend). So when the rules change, an agent
 * that resumes gets one inbox note quoting the new or reworded rules.
 *
 * Each rule is remembered by a short key of its wording, so rewording a rule
 * counts as a change. No electron / node imports: tests load it directly.
 */

export const HOUSE_RULES_CHANGED_SUBJECT = 'House rules changed';

/** FNV-1a, 32 bit, as hex: stable across launches, no crypto import. */
export function ruleKey(rule: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < rule.length; i++) {
    h ^= rule.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The numbered rules, without the "HOUSE RULES." heading line. */
export function houseRuleLines(rules: string): string[] {
  return rules.split('\n').filter((l) => /^\d+\.\s/.test(l));
}

/**
 * What to tell an agent as it starts. `seen` is the keys recorded at its last
 * start, or undefined when nothing was recorded. A fresh conversation reads the
 * rules in its instructions, so it gets no note; a resumed one with no record
 * gets every rule once, since its habits predate any record.
 */
export function houseRulesToTell(rules: string, seen: string[] | undefined, resumed: boolean): { tell: string[]; keys: string[] } {
  const lines = houseRuleLines(rules);
  const keys = lines.map(ruleKey);
  if (!resumed) return { tell: [], keys };
  if (!seen) return { tell: lines, keys };
  const known = new Set(seen);
  return { tell: lines.filter((_, i) => !known.has(keys[i])), keys };
}

export function houseRulesNoticeBody(tell: string[]): string {
  return [
    'Your house rules changed. These are new or reworded:',
    '',
    ...tell,
    '',
    'They apply from now on to everything you write, including a file you extend or update: rewrite its earlier parts that break them. Do not reply to this message.'
  ].join('\n');
}
