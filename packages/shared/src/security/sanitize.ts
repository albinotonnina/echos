const XML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export function sanitizeHtml(input: string): string {
  // Strip all HTML tags
  let clean = input.replace(/<[^>]*>/g, '');
  // Decode named entities
  clean = clean.replace(/&nbsp;/g, ' ');
  clean = clean.replace(/&amp;/g, '&');
  clean = clean.replace(/&lt;/g, '<');
  clean = clean.replace(/&gt;/g, '>');
  clean = clean.replace(/&quot;/g, '"');
  // Decode numeric entities (decimal e.g. &#39; and hex e.g. &#x27; or &#X27;)
  // Only decode valid Unicode code points, excluding surrogates (0xD800-0xDFFF)
  // and C0 control characters (0x00-0x1F) except TAB (9), LF (10), CR (13)
  clean = clean.replace(/&#(\d+);/g, (match, code: string) => {
    const codePoint = parseInt(code, 10);
    if (codePoint > 0x10FFFF || (codePoint >= 0xD800 && codePoint <= 0xDFFF)) return match;
    if (codePoint <= 0x1F && codePoint !== 9 && codePoint !== 10 && codePoint !== 13) return match;
    return String.fromCodePoint(codePoint);
  });
  clean = clean.replace(/&#[xX]([0-9a-fA-F]+);/g, (match, code: string) => {
    const codePoint = parseInt(code, 16);
    if (codePoint > 0x10FFFF || (codePoint >= 0xD800 && codePoint <= 0xDFFF)) return match;
    if (codePoint <= 0x1F && codePoint !== 9 && codePoint !== 10 && codePoint !== 13) return match;
    return String.fromCodePoint(codePoint);
  });
  // No re-encoding: all callers (YouTube, article) save to markdown, not HTML.
  // Undecoded entities (invalid surrogates, control chars) keep their raw & which is fine in markdown.
  return clean.trim();
}

export function escapeXml(input: string): string {
  return input.replace(/[&<>"']/g, (char) => XML_ENTITIES[char] ?? char);
}
