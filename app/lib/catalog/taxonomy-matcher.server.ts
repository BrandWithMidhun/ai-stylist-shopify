// Naive product → taxonomy node matcher (006a §4.3).
//
// v1 scoring: count occurrences of each node's matchKeywords in title +
// productType + shopifyTags (case-insensitive). Highest-scoring node wins;
// on tie the deepest leaf wins (most specific). When no node scores > 0
// the deepest root reachable wins as a last resort. Returns null when the
// shop has no taxonomy nodes at all.
//
// This is intentionally simple. Future iterations (TF-IDF, embedding-based
// matching) are out of scope for 006a.

import type { Product, TaxonomyNode } from "@prisma/client";
import prisma from "../../db.server";

type ProductForMatch = Pick<Product, "title" | "productType" | "shopifyTags">;

export type MatchInput = ProductForMatch;

export function matchProductToNode(
  product: MatchInput,
  nodes: readonly TaxonomyNode[],
): string | null {
  if (nodes.length === 0) return null;

  const haystack = buildHaystack(product);
  const depthByNodeId = computeDepths(nodes);

  let bestId: string | null = null;
  let bestScore = -1;
  let bestDepth = -1;

  for (const node of nodes) {
    let score = 0;
    for (const kw of node.matchKeywords) {
      const needle = kw.trim().toLowerCase();
      if (!needle) continue;
      if (haystack.includes(needle)) score += 1;
    }
    if (score === 0) continue;
    const depth = depthByNodeId.get(node.id) ?? 0;
    // Highest score wins, tie-break to deepest leaf, then to first-seen.
    if (score > bestScore || (score === bestScore && depth > bestDepth)) {
      bestId = node.id;
      bestScore = score;
      bestDepth = depth;
    }
  }

  if (bestId !== null) return bestId;

  // No keyword matched. Per spec §4.3, fall back to the (first) root node.
  const roots = nodes
    .filter((n) => n.parentId === null)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  return roots[0]?.id ?? null;
}

function buildHaystack(p: ProductForMatch): string {
  const parts: string[] = [p.title.toLowerCase()];
  if (p.productType) parts.push(p.productType.toLowerCase());
  for (const t of p.shopifyTags) parts.push(t.toLowerCase());
  return parts.join("  ");
}

// Map nodeId → depth (root=0). Computed by walking parents in the supplied
// node set; if a parent is missing (corrupt tree) we stop at that point.
function computeDepths(nodes: readonly TaxonomyNode[]): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const depthByNodeId = new Map<string, number>();
  for (const node of nodes) {
    let depth = 0;
    let current: TaxonomyNode | undefined = node;
    for (let i = 0; current && i < 16; i += 1) {
      if (!current.parentId) break;
      const parent = byId.get(current.parentId);
      if (!parent) break;
      depth += 1;
      current = parent;
    }
    depthByNodeId.set(node.id, depth);
  }
  return depthByNodeId;
}

// Bulk re-matcher used by the Re-match-all job. Loads the full node set
// once, walks every product in the shop, persists changes only when the
// match differs from the current taxonomyNodeId. Returns counts so the
// admin UI can surface "Matched X products to Y nodes."
export async function rematchAllProducts(
  shopDomain: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ updated: number; unchanged: number; nodes: number }> {
  const nodes = await prisma.taxonomyNode.findMany({ where: { shopDomain } });
  if (nodes.length === 0) {
    return { updated: 0, unchanged: 0, nodes: 0 };
  }

  const products = await prisma.product.findMany({
    where: { shopDomain, deletedAt: null },
    select: {
      id: true,
      title: true,
      productType: true,
      shopifyTags: true,
      taxonomyNodeId: true,
    },
  });

  let updated = 0;
  let unchanged = 0;
  const distinctMatched = new Set<string>();

  for (let i = 0; i < products.length; i += 1) {
    const p = products[i];
    const matchId = matchProductToNode(p, nodes);
    if (matchId !== null) distinctMatched.add(matchId);
    if (p.taxonomyNodeId !== matchId) {
      await prisma.product.update({
        where: { id: p.id },
        data: { taxonomyNodeId: matchId },
      });
      updated += 1;
    } else {
      unchanged += 1;
    }
    onProgress?.(i + 1, products.length);
  }

  return { updated, unchanged, nodes: distinctMatched.size };
}
