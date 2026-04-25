// Card renderer for the intelligence dashboard product grid.
//
// Spec §6.6: image + fallback, OOS badge, title (2-line clamp), source pill,
// up-to-4 inline tag chips, coverage progress bar (unique axes tagged /
// expected axes), exclude toggle.
//
// 005d additions:
//   - 3-dot ProductCardMenu (top-right of image): Generate / Mark Reviewed
//     / Edit. Trigger calls stopPropagation so it doesn't also fire onCardClick.
//   - Whole card body is the click target for opening the edit drawer.
//   - Exclude stays as a separate visible button (frequency-of-use → not in
//     the menu) and also stops propagation.

import { expectedAxesFor, type StoreMode } from "../../lib/catalog/store-axes";
import type { ProductListItem } from "../../lib/catalog/loader.server";
import { ProductCardMenu } from "./ProductCardMenu";
import { TagStatusPill } from "./TagStatusPill";

const DISPLAY_AXIS_PRIORITY = ["category", "fit", "color_family", "color", "occasion"];
const MAX_DISPLAY_TAGS = 4;

type Props = {
  product: ProductListItem;
  storeMode: StoreMode;
  onToggleExclude: (id: string, next: boolean) => void;
  excludePending: boolean;
  onEdit: (id: string) => void;
  onGenerate: (id: string) => void;
  onMarkReviewed: (id: string) => void;
  generating: boolean;
};

export function ProductCard({
  product,
  storeMode,
  onToggleExclude,
  excludePending,
  onEdit,
  onGenerate,
  onMarkReviewed,
  generating,
}: Props) {
  const expected = expectedAxesFor(storeMode);
  const uniqueAxesTagged = new Set(
    product.tags.filter((t) => expected.includes(t.axis)).map((t) => t.axis),
  );
  const coverage =
    expected.length === 0
      ? 0
      : Math.round((uniqueAxesTagged.size / expected.length) * 100);

  const displayTags = pickDisplayTags(product.tags);
  const excluded = product.recommendationExcluded;
  const outOfStock = product.inventoryStatus === "OUT_OF_STOCK";

  const hasAnyTag = product.tags.length > 0;
  const allHumanLocked =
    hasAnyTag &&
    product.tags.every((t) => t.source === "HUMAN" && t.locked === true);
  const canMarkReviewed = hasAnyTag && !allHumanLocked;
  // canGenerate: there's at least one expected axis without a current tag.
  const canGenerate = expected.some((axis) => !uniqueAxesTagged.has(axis));

  const openDrawer = () => onEdit(product.id);
  const handleKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDrawer();
    }
  };

  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      background={excluded ? "subdued" : "base"}
    >
      <style>{`
        .pc-card-${product.id} { position: relative; display: flex; flex-direction: column; gap: 8px; cursor: pointer; }
        .pc-card-${product.id} .pc-img-wrap { position: relative; aspect-ratio: 1/1; overflow: hidden; border-radius: 6px; background: #f4f4f4; }
        .pc-card-${product.id} .pc-oos { position: absolute; top: 6px; left: 6px; }
        .pc-card-${product.id} .pc-menu { position: absolute; top: 6px; right: 6px; }
        .pc-card-${product.id} .pc-generating-overlay { position: absolute; inset: 0; background: rgba(255,255,255,0.6); display: flex; align-items: center; justify-content: center; font-size: 12px; color: #202223; }
        .pc-card-${product.id} .pc-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .pc-card-${product.id} .pc-cov-track { height: 4px; background: #e1e3e5; border-radius: 2px; overflow: hidden; }
        .pc-card-${product.id} .pc-cov-fill { height: 100%; background: #008060; transition: width 200ms ease; }
        .pc-card-${product.id}${excluded ? "" : ""} { opacity: ${excluded ? "0.55" : "1"}; }
      `}</style>
      <div
        className={`pc-card-${product.id}`}
        role="button"
        tabIndex={0}
        aria-label={`Edit tags for ${product.title}`}
        onClick={openDrawer}
        onKeyDown={handleKey}
      >
        <div className="pc-img-wrap">
          {product.featuredImageUrl ? (
            <s-image
              src={product.featuredImageUrl}
              alt={product.title}
              aspectRatio="1/1"
              objectFit="cover"
              loading="lazy"
            />
          ) : null}
          {outOfStock ? (
            <span className="pc-oos">
              <s-badge tone="critical">Out of stock</s-badge>
            </span>
          ) : null}
          <div className="pc-menu">
            <ProductCardMenu
              productId={product.id}
              canGenerate={canGenerate}
              canMarkReviewed={canMarkReviewed}
              generating={generating}
              onGenerate={() => onGenerate(product.id)}
              onMarkReviewed={() => onMarkReviewed(product.id)}
              onEdit={() => onEdit(product.id)}
            />
          </div>
          {generating ? (
            <div className="pc-generating-overlay">Tagging…</div>
          ) : null}
        </div>
        <div className="pc-title">
          <s-text type="strong">{product.title}</s-text>
        </div>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <TagStatusPill status={product.tagStatus} />
          {displayTags.map((t) => (
            <s-chip key={`${t.axis}:${t.value}`} accessibility-label={`${t.axis}: ${t.value}`}>
              {t.value}
            </s-chip>
          ))}
        </s-stack>
        <div className="pc-cov-track" aria-label={`Tag coverage ${coverage}%`}>
          <div className="pc-cov-fill" style={{ width: `${coverage}%` }} />
        </div>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-text color="subdued">{coverage}% coverage</s-text>
          <span
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            role="presentation"
          >
            <s-button
              variant="tertiary"
              onClick={() => onToggleExclude(product.id, !excluded)}
              {...(excludePending ? { loading: true, disabled: true } : {})}
            >
              {excluded ? "Include" : "Exclude"}
            </s-button>
          </span>
        </s-stack>
      </div>
    </s-box>
  );
}

function pickDisplayTags(
  tags: ProductListItem["tags"],
): ProductListItem["tags"] {
  const byAxis = new Map<string, ProductListItem["tags"][number]>();
  for (const t of tags) {
    if (!byAxis.has(t.axis)) byAxis.set(t.axis, t);
  }
  const ordered: ProductListItem["tags"] = [];
  for (const axis of DISPLAY_AXIS_PRIORITY) {
    const tag = byAxis.get(axis);
    if (tag) {
      ordered.push(tag);
      byAxis.delete(axis);
    }
  }
  for (const tag of byAxis.values()) {
    if (ordered.length >= MAX_DISPLAY_TAGS) break;
    ordered.push(tag);
  }
  return ordered.slice(0, MAX_DISPLAY_TAGS);
}
