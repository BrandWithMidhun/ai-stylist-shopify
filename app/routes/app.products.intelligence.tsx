import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import type { StoreMode } from "../lib/merchant-config";
import {
  defaultMerchantConfig,
  getMerchantConfig,
} from "../lib/merchant-config.server";
import {
  fetchProductById,
  fetchProducts,
  type Product,
} from "../lib/shopify-products.server";
import {
  generateTagsForProduct,
  type TagResult,
} from "../lib/product-intelligence.server";

const PRODUCT_LIMIT = 50;

const DIMENSIONS = [
  { key: "style", label: "Style" },
  { key: "occasion", label: "Occasion" },
  { key: "color", label: "Color" },
  { key: "material", label: "Material" },
] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [products, existingConfig] = await Promise.all([
    fetchProducts(admin, PRODUCT_LIMIT),
    getMerchantConfig(session.shop),
  ]);
  const storeMode: StoreMode =
    (existingConfig?.storeMode as StoreMode | undefined) ??
    defaultMerchantConfig(session.shop).storeMode;
  return { shop: session.shop, storeMode, products };
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<TagResult> => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const productId = String(formData.get("productId") ?? "").trim();
  if (!productId) {
    return { ok: false, productId: "", error: "productId is required." };
  }

  const product = await fetchProductById(admin, productId);
  if (!product) {
    return {
      ok: false,
      productId,
      error: "Product not found. It may have been deleted.",
    };
  }

  const existingConfig = await getMerchantConfig(session.shop);
  const storeMode: StoreMode =
    (existingConfig?.storeMode as StoreMode | undefined) ??
    defaultMerchantConfig(session.shop).storeMode;

  return generateTagsForProduct(product, storeMode);
};

export default function ProductIntelligencePage() {
  const { products, storeMode } = useLoaderData<typeof loader>();

  const submitFns = useRef<Map<string, () => void>>(new Map());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

  const registerSubmit = useCallback(
    (id: string, submit: () => void) => {
      submitFns.current.set(id, submit);
      return () => {
        submitFns.current.delete(id);
      };
    },
    [],
  );

  const reportLoading = useCallback((id: string, isLoading: boolean) => {
    setLoadingIds((prev) => {
      const wasLoading = prev.has(id);
      if (isLoading === wasLoading) return prev;
      const next = new Set(prev);
      if (isLoading) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const anyLoading = loadingIds.size > 0;

  const generateAll = useCallback(() => {
    submitFns.current.forEach((submit) => submit());
  }, []);

  if (products.length === 0) {
    return (
      <s-page heading="Product intelligence">
        <s-section heading="No products yet">
          <s-paragraph>
            There are no products in this store. Visit the starter page and
            click &quot;Generate a product&quot; to add some demo products, then
            come back here.
          </s-paragraph>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Product intelligence">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={generateAll}
        {...(anyLoading ? { loading: true, disabled: true } : {})}
      >
        Generate tags for all
      </s-button>

      <s-section heading="Overview">
        <s-paragraph>
          Store mode: <s-text>{storeMode}</s-text>. Click &quot;Generate
          tags&quot; on a product to have Claude analyze it and suggest
          structured tags across category, style, occasion, color, and
          material. Tags are shown here only — they are not written back to
          Shopify.
        </s-paragraph>
      </s-section>

      {products.map((product) => (
        <ProductRow
          key={product.id}
          product={product}
          registerSubmit={registerSubmit}
          reportLoading={reportLoading}
        />
      ))}
    </s-page>
  );
}

type ProductRowProps = {
  product: Product;
  registerSubmit: (id: string, submit: () => void) => () => void;
  reportLoading: (id: string, isLoading: boolean) => void;
};

function ProductRow({
  product,
  registerSubmit,
  reportLoading,
}: ProductRowProps) {
  const fetcher = useFetcher<typeof action>();
  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  const submit = useCallback(() => {
    fetcher.submit(
      { productId: product.id },
      { method: "POST", action: "/app/products/intelligence" },
    );
  }, [fetcher, product.id]);

  useEffect(() => registerSubmit(product.id, submit), [
    registerSubmit,
    product.id,
    submit,
  ]);

  useEffect(() => {
    reportLoading(product.id, isLoading);
  }, [reportLoading, product.id, isLoading]);

  const result = fetcher.data;

  return (
    <s-section heading={product.title}>
      <s-stack direction="inline" gap="base" alignItems="start">
        {product.imageUrl ? (
          <s-box inlineSize="96px" blockSize="96px">
            <s-image
              src={product.imageUrl}
              alt={product.imageAlt ?? product.title}
              inlineSize="fill"
              aspectRatio="1 / 1"
              objectFit="cover"
            />
          </s-box>
        ) : (
          <s-text>(No image)</s-text>
        )}
        <s-stack direction="block" gap="base">
          <s-paragraph>
            <s-text>Handle: {product.handle}</s-text>
          </s-paragraph>

          <s-stack direction="block" gap="small-100">
            <s-heading>Current Shopify tags</s-heading>
            {product.tags.length > 0 ? (
              <s-stack direction="inline" gap="small-100">
                {product.tags.map((tag) => (
                  <s-badge key={tag}>{tag}</s-badge>
                ))}
              </s-stack>
            ) : (
              <s-text>No tags yet</s-text>
            )}
          </s-stack>

          <s-button
            onClick={submit}
            {...(isLoading ? { loading: true, disabled: true } : {})}
          >
            Generate tags
          </s-button>

          <TagOutput isLoading={isLoading} result={result} />
        </s-stack>
      </s-stack>
    </s-section>
  );
}

type TagOutputProps = {
  isLoading: boolean;
  result: TagResult | undefined;
};

function TagOutput({ isLoading, result }: TagOutputProps) {
  if (isLoading) {
    return (
      <s-stack direction="inline" gap="base" alignItems="center">
        <s-spinner accessibilityLabel="Generating tags" size="base" />
        <s-text>Generating tags…</s-text>
      </s-stack>
    );
  }
  if (!result) {
    return null;
  }
  if (!result.ok) {
    return (
      <s-banner tone="critical" heading="Tag generation failed">
        <s-paragraph>{result.error}</s-paragraph>
      </s-banner>
    );
  }

  const { tags } = result;
  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="block" gap="small-100">
        <s-heading>Category</s-heading>
        <s-badge>{tags.category}</s-badge>
      </s-stack>
      {DIMENSIONS.map((dim) => {
        const values = tags[dim.key];
        return (
          <s-stack key={dim.key} direction="block" gap="small-100">
            <s-heading>{dim.label}</s-heading>
            {values.length > 0 ? (
              <s-stack direction="inline" gap="small-100">
                {values.map((value) => (
                  <s-badge key={value}>{value}</s-badge>
                ))}
              </s-stack>
            ) : (
              <s-text>—</s-text>
            )}
          </s-stack>
        );
      })}
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
