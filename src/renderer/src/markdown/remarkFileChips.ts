/**
 * Files named in a reply or an Ask me question become chips in place of their
 * path (docs/designs/open-file-tab.md, R1 and R2): a code span with a known
 * file ending, a full path written in plain text, or a Markdown link to a full
 * path. Each becomes an inline element `cth-file` carrying the path, which
 * MarkdownPreview renders with the host's chip.
 *
 * Plain text is matched against the SOURCE, not the parsed text: Markdown
 * treats a backslash before punctuation as an escape, so `C:\Reports\_q3.md`
 * parses as `C:\Reports_q3.md`. The path is read from the source by the text
 * node's position and found in the parsed text by its unescaped form. Runs
 * before remarkSoftBreaks, whose split text nodes carry no position.
 */
import { fileTitle, isAbsolutePathText, isFileSpan, plainFilePaths, unescapeMarkdown } from '@shared/askFiles';

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: Record<string, unknown>;
}

const chip = (path: string): MdNode => ({
  type: 'inlineCode',
  value: fileTitle(path),
  data: { hName: 'cth-file', hProperties: { dataPath: path } }
});

function splitText(node: MdNode, source: string): MdNode[] | null {
  const value = node.value ?? '';
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  const raw = start != null && end != null ? source.slice(start, end) : value;
  const found = plainFilePaths(raw);
  if (!found.length) return null;
  const out: MdNode[] = [];
  let at = 0;
  for (const f of found) {
    const shown = raw === value ? f.path : unescapeMarkdown(f.path);
    const i = raw === value ? f.start : value.indexOf(shown, at);
    if (i < at) continue;
    if (i > at) out.push({ type: 'text', value: value.slice(at, i) });
    out.push(chip(f.path));
    at = i + shown.length;
  }
  if (!out.length) return null;
  if (at < value.length) out.push({ type: 'text', value: value.slice(at) });
  return out;
}

function walk(node: MdNode, source: string): void {
  const children = node.children;
  if (!children) return;
  const out: MdNode[] = [];
  for (const child of children) {
    if (child.type === 'text') {
      const parts = splitText(child, source);
      if (parts) { out.push(...parts); continue; }
    } else if (child.type === 'inlineCode' && typeof child.value === 'string' && isFileSpan(child.value)) {
      out.push(chip(child.value.trim()));
      continue;
    } else if (child.type === 'link' && typeof child.url === 'string' && isAbsolutePathText(child.url) && isFileSpan(child.url)) {
      out.push(chip(child.url));
      continue;
    } else if (child.type !== 'code' && child.type !== 'link') {
      // Not into a link: a chip is a button, and a button never sits in a link.
      walk(child, source);
    }
    out.push(child);
  }
  node.children = out;
}

export function remarkFileChips() {
  return (tree: unknown, file: { value?: unknown }): void => { walk(tree as MdNode, String(file.value ?? '')); };
}
