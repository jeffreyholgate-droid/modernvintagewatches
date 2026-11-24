import { PublishState } from '../../types.js';

/** Generated text is a draft until a person has checked it against the source. */
export function buildCurationDraft(normalized: unknown, copy: unknown) {
  const data = normalized as { brand?: unknown; model?: unknown } | null;
  const text = copy as { long_description?: unknown } | null;
  if (typeof data?.brand !== 'string' || typeof data.model !== 'string' ||
      typeof text?.long_description !== 'string') throw new Error('CURATION_OUTPUT_INVALID');
  const titleBoutique = `${data.brand.trim()} ${data.model.trim()}`.trim();
  const description = text.long_description.trim();
  if (!titleBoutique || !description) throw new Error('CURATION_OUTPUT_EMPTY');
  return { titleBoutique, description, publishStatus: PublishState.DRAFT };
}
