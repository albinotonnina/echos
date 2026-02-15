const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
};

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
  // Decode common entities
  clean = clean.replace(/&nbsp;/g, ' ');
  clean = clean.replace(/&amp;/g, '&');
  clean = clean.replace(/&lt;/g, '<');
  clean = clean.replace(/&gt;/g, '>');
  clean = clean.replace(/&quot;/g, '"');
  clean = clean.replace(/&#x27;/g, "'");
  // Re-escape for safety
  clean = clean.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char] ?? char);
  return clean.trim();
}

export function escapeXml(input: string): string {
  return input.replace(/[&<>"']/g, (char) => XML_ENTITIES[char] ?? char);
}
