/** Turns a fetched article page into the typed block model defined in ipc-contract.ts. Readability
 * does the real work of separating article prose from nav/ads/related-links chrome — a hand-rolled
 * `<p>` scrape was tested and confirmed to pull in nav text ("Sections Forum") and inline CSS, which
 * is exactly the class of bug a real extractor exists to avoid.
 *
 * linkedom, not jsdom: 910 KB unpacked with five small deps vs. jsdom's 7.1 MB and ~18 transitive
 * deps (undici, parse5, css-tree, tough-cookie, whatwg-url, ...) — on Render's 512MB free tier,
 * jsdom's per-parse memory is the single most likely way to OOM the box.
 *
 * The server NEVER hands the browser raw HTML from this — see ipc-contract.ts's ReaderBlock. Every
 * block is walked into a small typed union and every run's text goes through React's normal
 * escaping on the way out; there is no dangerouslySetInnerHTML anywhere in this feature. */

import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import type { ReaderBlock, ReaderRun } from '../../ipc-contract';

const MIN_TEXT_LENGTH = 800;
const MAX_BLOCKS = 400;
const MAX_CHARS = 60_000;

// Phrases that show up in the *visible* extracted text of a metered/soft-paywalled page even when
// Readability successfully found "an article" — the extraction succeeded but what it found is a
// teaser, not the story. Checked against only the first slice of text since these markers, when
// present, are near the top or bottom of a truncated body, and scanning the whole thing would risk
// a false positive from an unrelated later mention of "subscribe".
const SOFT_PAYWALL_RE =
  /subscribe to (continue|read)|already a subscriber|this article is for subscribers|create a free account to (continue|read)|sign in to continue reading/i;

export type ExtractOutcome =
  | {
      ok: true;
      blocks: ReaderBlock[];
      title: string | null;
      byline: string | null;
      wordCount: number;
      truncated: boolean;
      partial: boolean;
    }
  | { ok: false; reason: 'too-short' };

/** Resolves a possibly-relative href/src against the page's real final URL (after redirects) and
 * drops anything that isn't http/https — this is what keeps a `javascript:`/`data:` URI out of the
 * block model at the source, rather than relying on sanitizing it later. Readability's own
 * `_fixRelativeUris` is NOT used for this: it reads `document.baseURI`, which linkedom's
 * `parseHTML` leaves null (confirmed live), so it would silently leave relative URLs unresolved. */
function absolutize(raw: string | null | undefined, finalUrl: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, finalUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

const INLINE_STYLE_TAGS = new Set(['strong', 'b', 'em', 'i', 'a']);
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'iframe', 'video', 'audio', 'button', 'form', 'svg']);

/** Walks a block-level element's children into flat inline runs. Not a full rich-text tree — runs
 * are flattened to (text, href?, em?, strong?) — but article prose rarely nests beyond
 * strong/em/a combinations, and the flat shape is what keeps ReaderBlocks.tsx a trivial map with no
 * recursive rendering of its own. Adjacent runs with identical formatting are merged so a sentence
 * split across several DOM text nodes doesn't fragment into a run per node. */
function walkInline(el: Element, finalUrl: string, style: { em?: boolean; strong?: boolean; href?: string }): ReaderRun[] {
  const runs: ReaderRun[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ');
      if (!text.trim()) continue;
      const last = runs[runs.length - 1];
      if (last && last.href === style.href && !!last.em === !!style.em && !!last.strong === !!style.strong) {
        last.text += text;
      } else {
        runs.push({ text, ...style });
      }
    } else if (node.nodeType === 1 /* ELEMENT_NODE */) {
      const child = node as Element;
      const tag = child.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;
      if (!INLINE_STYLE_TAGS.has(tag)) {
        runs.push(...walkInline(child, finalUrl, style));
        continue;
      }
      const nextStyle = { ...style };
      if (tag === 'strong' || tag === 'b') nextStyle.strong = true;
      if (tag === 'em' || tag === 'i') nextStyle.em = true;
      if (tag === 'a') {
        const href = absolutize(child.getAttribute('href'), finalUrl);
        if (href) nextStyle.href = href;
      }
      runs.push(...walkInline(child, finalUrl, nextStyle));
    }
  }
  return runs;
}

const BLOCK_TAG_MAP: Record<string, 'p' | 'h2' | 'h3' | 'blockquote'> = {
  p: 'p',
  h1: 'h2',
  h2: 'h2',
  h3: 'h3',
  h4: 'h3',
  h5: 'h3',
  h6: 'h3',
  blockquote: 'blockquote',
};

/** Walks the extracted article body into the flat block list. Container elements (div, section,
 * figure, ul/ol) are recursed into rather than mapped 1:1 — publishers wrap paragraphs in an
 * arbitrary amount of div soup, and only the leaf block types below actually mean something to the
 * reader. */
function walkBlocks(root: Element, finalUrl: string, out: ReaderBlock[]): void {
  for (const node of Array.from(root.childNodes)) {
    if (out.length >= MAX_BLOCKS) return;
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) continue;

    const mapped = BLOCK_TAG_MAP[tag];
    if (mapped) {
      const runs = walkInline(el, finalUrl, {});
      if (runs.some((r) => r.text.trim())) out.push({ type: mapped, runs });
      continue;
    }
    if (tag === 'li') {
      const runs = walkInline(el, finalUrl, {});
      if (runs.some((r) => r.text.trim())) out.push({ type: 'li', runs });
      continue;
    }
    if (tag === 'ul' || tag === 'ol') {
      walkBlocks(el, finalUrl, out);
      continue;
    }
    if (tag === 'img' || tag === 'figure') {
      const imgEl = tag === 'img' ? el : el.querySelector('img');
      const src = absolutize(imgEl?.getAttribute('src'), finalUrl);
      if (src) {
        const captionEl = tag === 'figure' ? el.querySelector('figcaption') : null;
        out.push({
          type: 'img',
          src,
          alt: imgEl?.getAttribute('alt') || null,
          caption: captionEl?.textContent?.trim() || null,
        });
      }
      continue;
    }
    // Generic container (div, section, span, article, ...) — recurse rather than skip, since
    // publishers routinely wrap real paragraphs in one or more divs.
    walkBlocks(el, finalUrl, out);
  }
}

/** Shared by both content tiers (Readability's serialized output here, the Guardian API's `body`
 * HTML field in guardianBody.ts) — an HTML fragment in, the capped block list out. Kept here rather
 * than duplicated since both are "some HTML fragment, walk it into blocks, cap it" with identical
 * rules. */
export function blocksFromHtmlFragment(html: string, finalUrl: string): { blocks: ReaderBlock[]; truncated: boolean } {
  const { document: articleDoc } = parseHTML(`<div id="reader-root">${html}</div>`);
  const root = articleDoc.getElementById('reader-root');
  const blocks: ReaderBlock[] = [];
  if (root) walkBlocks(root, finalUrl, blocks);

  let charCount = 0;
  let truncated = false;
  const capped: ReaderBlock[] = [];
  for (const b of blocks) {
    const len = b.type === 'img' ? 0 : b.runs.reduce((n, r) => n + r.text.length, 0);
    if (charCount + len > MAX_CHARS) {
      truncated = true;
      break;
    }
    capped.push(b);
    charCount += len;
  }
  if (blocks.length > capped.length) truncated = true;
  return { blocks: capped, truncated };
}

export function extractReadable(html: string, finalUrl: string): ExtractOutcome {
  const { document } = parseHTML(html);
  const parsed = new Readability(document, { charThreshold: 500 }).parse();
  // Readability's own types mark textContent/content nullable even though a successful parse
  // always populates both — normalized once here so nothing below has to keep re-guarding it.
  const text = parsed?.textContent ?? '';

  if (!parsed || text.trim().length < MIN_TEXT_LENGTH) {
    return { ok: false, reason: 'too-short' };
  }

  // Re-parsing parsed.content (Readability's own serialized HTML, much smaller than the original
  // page) rather than walking Readability's internal DOM directly — that internal node isn't part
  // of its public API, and this keeps extract.ts decoupled from Readability's implementation
  // details the same way the rest of this file already treats it as a black box.
  const { blocks, truncated } = blocksFromHtmlFragment(parsed.content ?? '', finalUrl);

  const partial = SOFT_PAYWALL_RE.test(text.slice(0, 2000));
  const wordCount = text.trim().split(/\s+/).length;

  return {
    ok: true,
    blocks,
    title: parsed.title || null,
    byline: parsed.byline || null,
    wordCount,
    truncated,
    partial,
  };
}
