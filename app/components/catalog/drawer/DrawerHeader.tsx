// Header strip for ProductEditDrawer: thumbnail, title, status pill,
// close button.

import type { ProductListItem } from "../../../lib/catalog/loader.server";
import { TagStatusPill } from "../TagStatusPill";

type Props = {
  product: ProductListItem;
  onClose: () => void;
};

export function DrawerHeader({ product, onClose }: Props) {
  return (
    <div className="ped-header">
      {product.featuredImageUrl ? (
        <img
          src={product.featuredImageUrl}
          alt=""
          className="ped-thumb"
          loading="lazy"
        />
      ) : (
        <div className="ped-thumb" />
      )}
      <div className="ped-title-wrap">
        <div className="ped-title">{product.title}</div>
        <div style={{ marginTop: 4 }}>
          <TagStatusPill status={product.tagStatus} />
        </div>
      </div>
      <button
        type="button"
        className="ped-close"
        aria-label="Close"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}
