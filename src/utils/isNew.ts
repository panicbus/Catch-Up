export function isNewArticle(publishedAtIso: string): boolean {
  const ageMs = Date.now() - new Date(publishedAtIso).getTime();
  return ageMs < 24 * 60 * 60 * 1000;
}
