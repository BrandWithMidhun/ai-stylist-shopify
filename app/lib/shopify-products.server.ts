import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

export type Product = {
  id: string;
  handle: string;
  title: string;
  description: string;
  imageUrl: string | null;
  imageAlt: string | null;
  tags: string[];
};

const DESCRIPTION_MAX = 500;

const PRODUCTS_QUERY = `#graphql
  query GetProductsForIntelligence($first: Int!) {
    products(first: $first, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
          id
          handle
          title
          description
          tags
          featuredMedia {
            preview {
              image {
                url
                altText
              }
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_BY_ID_QUERY = `#graphql
  query GetProductForIntelligence($id: ID!) {
    product(id: $id) {
      id
      handle
      title
      description
      tags
      featuredMedia {
        preview {
          image {
            url
            altText
          }
        }
      }
    }
  }
`;

type RawProductNode = {
  id: string;
  handle: string;
  title: string;
  description: string | null;
  tags: string[];
  featuredMedia: {
    preview: {
      image: {
        url: string | null;
        altText: string | null;
      } | null;
    } | null;
  } | null;
};

function toProduct(node: RawProductNode): Product {
  const description = (node.description ?? "").slice(0, DESCRIPTION_MAX);
  const image = node.featuredMedia?.preview?.image ?? null;
  return {
    id: node.id,
    handle: node.handle,
    title: node.title,
    description,
    imageUrl: image?.url ?? null,
    imageAlt: image?.altText ?? null,
    tags: node.tags ?? [],
  };
}

export async function fetchProducts(
  admin: AdminApiContext,
  limit: number,
): Promise<Product[]> {
  const first = Math.min(Math.max(1, Math.floor(limit)), 50);
  const response = await admin.graphql(PRODUCTS_QUERY, {
    variables: { first },
  });
  const json = (await response.json()) as {
    data?: { products?: { edges: { node: RawProductNode }[] } };
  };
  const edges = json.data?.products?.edges ?? [];
  return edges.map((edge) => toProduct(edge.node));
}

export async function fetchProductById(
  admin: AdminApiContext,
  id: string,
): Promise<Product | null> {
  const response = await admin.graphql(PRODUCT_BY_ID_QUERY, {
    variables: { id },
  });
  const json = (await response.json()) as {
    data?: { product: RawProductNode | null };
  };
  const node = json.data?.product;
  return node ? toProduct(node) : null;
}
