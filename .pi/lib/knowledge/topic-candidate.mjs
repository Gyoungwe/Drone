function titleFromSummary(summary, query, resultSlug) {
  const heading = String(summary || '').match(/^#\s+(.+)$/m)?.[1]?.trim();
  const fallback = String(query || '').split(/[\n。]/)[0].trim();
  const slug = String(resultSlug || 'research-topic')
    .replace(/[-_]20\d{6,14}$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return (heading || fallback || slug || 'Research topic').slice(0, 180);
}

function fileStem(resultSlug, title) {
  let value = String(resultSlug || '').replace(/[-_]20\d{6,14}$/, '').trim();
  if (!value || value === 'research-question') value = String(title || 'research-topic');
  value = value.normalize('NFKC')
    .replace(/[\\/\[\]#|<>:"*?\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\- ]+|[.\- ]+$/g, '')
    .slice(0, 120);
  return value || 'research-topic';
}

export function autoTopicCandidate({ summary, query, resultSlug, sourcePaths = [] } = {}) {
  const markdown = String(summary || '').trim();
  if (markdown.length < 160) return { eligible: false, reason: 'summary-too-short' };
  if (markdown.length > 24000) return { eligible: false, reason: 'summary-too-large' };
  if (!Array.isArray(sourcePaths) || sourcePaths.length < 1) {
    return { eligible: false, reason: 'no-current-read-evidence' };
  }
  const title = titleFromSummary(markdown, query, resultSlug);
  const stem = fileStem(resultSlug, title);
  return {
    eligible: true,
    input: {
      path: `Wiki/${stem}.md`,
      title,
      markdown,
      rationale: 'Automatically staged from a completed, evidence-gated research run. Review scope, claims and applicability before publishing.',
      source_paths: sourcePaths.slice(0, 12),
    },
  };
}
