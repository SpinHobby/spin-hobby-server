/** A category of the shop's tree, as stored. */
export interface CategoryNode {
  id: string;
  parentId: string | null;
  name: string;
}

/** A category with the names from the top of the tree down to it, and the name an outside app gives back to mean it. */
export interface LabelledCategory extends CategoryNode {
  path: string[];
  /** Its own name when no other category has that name, else its path ("Figures › Other"). */
  label: string;
}

export const PATH_SEPARATOR = ' › ';

/** Compared without regard to case, spacing, punctuation or "&"/"and": "Figures > Bishoujo figures" is "Figures › Bishoujo Figures". */
const key = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Every category with its path and label, top-level categories first, each followed by the ones under it. */
export function labelCategories(nodes: CategoryNode[]): LabelledCategory[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pathOf = (n: CategoryNode) => {
    const names: string[] = [];
    for (
      let at: CategoryNode | undefined = n, guard = 0;
      at && guard < 50;
      at = at.parentId ? byId.get(at.parentId) : undefined, guard++
    )
      names.unshift(at.name);
    return names;
  };
  const count = new Map<string, number>();
  for (const n of nodes) count.set(key(n.name), (count.get(key(n.name)) ?? 0) + 1);
  return nodes
    .map((n) => {
      const path = pathOf(n);
      return {
        ...n,
        path,
        label: (count.get(key(n.name)) ?? 0) > 1 ? path.join(PATH_SEPARATOR) : n.name,
      };
    })
    .sort((a, b) => a.path.join('\u0000').localeCompare(b.path.join('\u0000')));
}

/** The category a name means: its label, its whole path, or its own name when only one category has it. Null when it is none of the shop's. */
export function findCategory(
  categories: LabelledCategory[],
  said: string | null | undefined,
): LabelledCategory | null {
  if (!said?.trim()) return null;
  const k = key(said);
  const byPath = categories.find((c) => key(c.path.join(' ')) === k || key(c.label) === k);
  if (byPath) return byPath;
  const byName = categories.filter((c) => key(c.name) === k);
  return byName.length === 1 ? byName[0] : null;
}
