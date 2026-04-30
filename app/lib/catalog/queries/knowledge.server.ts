// Phase 1 (PR-A): Admin GraphQL queries for the knowledge ingestion path.
//
// Why a new file rather than extending graphql.server.ts: the existing
// queries serve the legacy products-only sync flow and are shaped for
// 100/page bulk fetches. Knowledge queries inline metafields and
// collection memberships, which inflates per-query cost — they need
// smaller page sizes (50) and a different result shape. Keeping them
// separate makes the cost trade-off explicit per call site.
//
// Pagination defaults:
//   - products: 50 per page (down from the legacy 100; metafields/
//     collections inline pushes cost up fast)
//   - metafields per product: 50 inline; cursor-page via
//     PRODUCT_METAFIELDS_PAGE_QUERY when hasNextPage
//   - collections: 50 per page (metadata only — no inline products)
//   - metaobjects: 50 per type per page
//
// The reference union covers what we care about today. Phase 1 doesn't
// resolve every reference inline — for metaobject_reference values we
// store the GID and fill the Metaobject row separately during the
// METAOBJECTS phase. The inline reference lookup here is purely so we
// can capture {id, type, handle} when the GraphQL response happens to
// include it, saving a follow-up query for the common case.

const REFERENCE_FRAGMENT = `#graphql
  __typename
  ... on Metaobject {
    id
    type
    handle
  }
  ... on MediaImage { id }
  ... on Product { id }
  ... on Collection { id }
  ... on Page { id }
`;

const METAFIELD_FIELDS = `#graphql
  id
  namespace
  key
  type
  value
  updatedAt
  reference {
    ${REFERENCE_FRAGMENT}
  }
`;

// Single product. Used by:
//   - PR-C webhook handlers (after products/update fires, fetch the rich
//     record because the webhook payload doesn't include metafields/
//     collections)
//   - PR-D delta cron (per-product reconciliation pass)
//   - PR-B worker as a fallback when a page-level fetch errors out for
//     a single product
export const PRODUCT_KNOWLEDGE_BY_ID_QUERY = `#graphql
  query ProductKnowledgeById($id: ID!) {
    product(id: $id) {
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
      featuredImage { url }
      images(first: 20) {
        nodes { url }
      }
      priceRangeV2 {
        minVariantPrice { amount currencyCode }
        maxVariantPrice { amount currencyCode }
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
          selectedOptions { name value }
          image { url }
          inventoryItem { id }
        }
      }
      metafields(first: 50) {
        pageInfo { hasNextPage endCursor }
        nodes {
          ${METAFIELD_FIELDS}
        }
      }
      collections(first: 50) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          handle
          title
        }
      }
    }
  }
`;

// Cursor-page metafields for products with >50 metafields. Rare but
// real (jewelry stores with detailed cert metafields hit this).
export const PRODUCT_METAFIELDS_PAGE_QUERY = `#graphql
  query ProductMetafieldsPage($id: ID!, $cursor: String!) {
    product(id: $id) {
      id
      metafields(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          ${METAFIELD_FIELDS}
        }
      }
    }
  }
`;

// Bulk page query used by PR-B's worker for INITIAL / MANUAL_RESYNC /
// DELTA. The optional $query param accepts Shopify's search syntax —
// DELTA uses `updated_at:>=...` to fetch only recently-changed
// products. INITIAL/MANUAL_RESYNC pass null.
// PR-C.5: query expanded to carry the full Product write-set so the
// worker is the single authoritative writer (legacy upsert no longer
// runs from product webhooks). Field shape matches PRODUCTS_PAGE_QUERY
// in graphql.server.ts; cost increase per page is bounded by the
// existing first:50 page size.
export const PRODUCT_KNOWLEDGE_PAGE_QUERY = `#graphql
  query ProductKnowledgePage($cursor: String, $query: String) {
    products(first: 50, after: $cursor, query: $query) {
      pageInfo { hasNextPage endCursor }
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
        featuredImage { url }
        images(first: 20) {
          nodes { url }
        }
        priceRangeV2 {
          minVariantPrice { amount currencyCode }
          maxVariantPrice { amount currencyCode }
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
            selectedOptions { name value }
            image { url }
            inventoryItem { id }
          }
        }
        metafields(first: 50) {
          pageInfo { hasNextPage }
          nodes {
            ${METAFIELD_FIELDS}
          }
        }
        collections(first: 50) {
          pageInfo { hasNextPage }
          nodes {
            id
            handle
            title
          }
        }
      }
    }
  }
`;

// Collections phase — pulls metadata only; product memberships come
// from the product side (each product reports its collections inline).
// The ruleSet field tells us whether a collection is smart (has rules)
// or custom (manually curated). Smart collections need extra cron care
// because Shopify recomputes membership without firing webhooks.
export const COLLECTIONS_PAGE_QUERY = `#graphql
  query CollectionsPage($cursor: String) {
    collections(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        title
        descriptionHtml
        sortOrder
        templateSuffix
        updatedAt
        ruleSet {
          rules { column relation condition }
        }
      }
    }
  }
`;

export const COLLECTION_BY_ID_QUERY = `#graphql
  query CollectionById($id: ID!) {
    collection(id: $id) {
      id
      handle
      title
      descriptionHtml
      sortOrder
      templateSuffix
      updatedAt
      ruleSet {
        rules { column relation condition }
      }
    }
  }
`;

// Discover the merchant's metaobject definition types so the worker
// can iterate. Most stores have <5 types; rate cost is trivial.
export const METAOBJECT_DEFINITIONS_QUERY = `#graphql
  query MetaobjectDefinitions($cursor: String) {
    metaobjectDefinitions(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        type
        name
      }
    }
  }
`;

// Per-type metaobject pagination. The fields() block returns the
// flat list of field key/value/type/reference for each instance.
export const METAOBJECTS_BY_TYPE_PAGE_QUERY = `#graphql
  query MetaobjectsByType($type: String!, $cursor: String) {
    metaobjects(type: $type, first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        type
        handle
        displayName
        updatedAt
        fields {
          key
          type
          value
          reference {
            ${REFERENCE_FRAGMENT}
          }
        }
      }
    }
  }
`;

export const METAOBJECT_BY_ID_QUERY = `#graphql
  query MetaobjectById($id: ID!) {
    metaobject(id: $id) {
      id
      type
      handle
      displayName
      updatedAt
      fields {
        key
        type
        value
        reference {
          ${REFERENCE_FRAGMENT}
        }
      }
    }
  }
`;

// --- Result types ---------------------------------------------------------

export type GqlReference =
  | { __typename: "Metaobject"; id: string; type: string; handle: string | null }
  | { __typename: "MediaImage"; id: string }
  | { __typename: "Product"; id: string }
  | { __typename: "Collection"; id: string }
  | { __typename: "Page"; id: string }
  | { __typename: string };

export type GqlMetafield = {
  id: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
  updatedAt: string | null;
  reference: GqlReference | null;
};

export type GqlCollectionRef = {
  id: string;
  handle: string;
  title: string;
};

export type GqlKnowledgeProductMoney = {
  amount: string;
  currencyCode: string;
};

export type GqlKnowledgeProductVariant = {
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

export type GqlKnowledgeProduct = {
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
    minVariantPrice: GqlKnowledgeProductMoney;
    maxVariantPrice: GqlKnowledgeProductMoney;
  } | null;
  variants: { nodes: GqlKnowledgeProductVariant[] };
  metafields: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: GqlMetafield[];
  };
  collections: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: GqlCollectionRef[];
  };
};

export type GqlCollection = {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string | null;
  sortOrder: string | null;
  templateSuffix: string | null;
  updatedAt: string;
  ruleSet: {
    rules: Array<{ column: string; relation: string; condition: string }>;
  } | null;
};

export type GqlMetaobjectField = {
  key: string;
  type: string;
  value: string;
  reference: GqlReference | null;
};

export type GqlMetaobject = {
  id: string;
  type: string;
  handle: string | null;
  displayName: string | null;
  updatedAt: string;
  fields: GqlMetaobjectField[];
};

export type GqlMetaobjectDefinition = {
  id: string;
  type: string;
  name: string;
};

export type ProductKnowledgeByIdResponse = {
  product: GqlKnowledgeProduct | null;
};

export type ProductMetafieldsPageResponse = {
  product: {
    id: string;
    metafields: GqlKnowledgeProduct["metafields"];
  } | null;
};

export type ProductKnowledgePageResponse = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: GqlKnowledgeProduct[];
  };
};

export type CollectionsPageResponse = {
  collections: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: GqlCollection[];
  };
};

export type CollectionByIdResponse = {
  collection: GqlCollection | null;
};

export type MetaobjectDefinitionsResponse = {
  metaobjectDefinitions: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: GqlMetaobjectDefinition[];
  };
};

export type MetaobjectsByTypeResponse = {
  metaobjects: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: GqlMetaobject[];
  };
};

export type MetaobjectByIdResponse = {
  metaobject: GqlMetaobject | null;
};

// Helper: a collection is "smart" iff it has a ruleSet with rules.
export function isSmartCollection(c: GqlCollection): boolean {
  return Boolean(c.ruleSet && c.ruleSet.rules.length > 0);
}
