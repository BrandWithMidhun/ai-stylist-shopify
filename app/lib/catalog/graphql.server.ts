// Shopify Admin GraphQL queries used by the catalog sync worker.
//
// Notes:
// - images(first: 20): capped deliberately. Shopify allows up to 250 images
//   per product; tagging and chat retrieval don't need more than ~20.
// - variants(first: 100): the Shopify default limit per page.
// - We fetch ACTIVE, DRAFT, and ARCHIVED together; the sync should mirror the
//   merchant's full catalog.

export const PRODUCTS_COUNT_QUERY = `#graphql
  query ProductsCount {
    productsCount {
      count
    }
  }
`;

export const PRODUCTS_PAGE_QUERY = `#graphql
  query ProductsPage($cursor: String) {
    products(first: 100, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        handle
        title
        descriptionHtml
        productType
        vendor
        status
        tags
        totalInventory
        createdAt
        updatedAt
        featuredImage {
          url
        }
        images(first: 20) {
          nodes {
            url
          }
        }
        priceRangeV2 {
          minVariantPrice {
            amount
            currencyCode
          }
          maxVariantPrice {
            amount
            currencyCode
          }
        }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            price
            compareAtPrice
            inventoryQuantity
            availableForSale
            selectedOptions {
              name
              value
            }
            image {
              url
            }
            inventoryItem {
              id
            }
          }
        }
      }
    }
  }
`;

export type GqlMoney = {
  amount: string;
  currencyCode: string;
};

export type GqlVariant = {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number | null;
  availableForSale: boolean;
  selectedOptions: Array<{ name: string; value: string }>;
  image: { url: string } | null;
  inventoryItem: { id: string } | null;
};

export type GqlProduct = {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string | null;
  productType: string | null;
  vendor: string | null;
  status: string;
  tags: string[];
  totalInventory: number | null;
  createdAt: string;
  updatedAt: string;
  featuredImage: { url: string } | null;
  images: { nodes: Array<{ url: string }> };
  priceRangeV2: {
    minVariantPrice: GqlMoney;
    maxVariantPrice: GqlMoney;
  } | null;
  variants: { nodes: GqlVariant[] };
};

export type ProductsPageResponse = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: GqlProduct[];
  };
};

export type ProductsCountResponse = {
  productsCount: { count: number };
};
