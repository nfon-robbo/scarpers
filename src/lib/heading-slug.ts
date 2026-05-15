// Convert heading text into a URL-safe anchor slug.
// Used by both the blog editor (TOC links) and the blog renderer (heading ids)
// so anchor links in the TOC always resolve to the matching heading.
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9\s-]/g, "")    // strip punctuation
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "section";
}
