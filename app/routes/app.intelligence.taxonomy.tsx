// Taxonomy admin page (006a §4.4).
//
// Loader: full tree for the shop.
// Layout: tree on the left, selected node editor on the right, top toolbar
// with "Re-match all products" (decision H — no confirm, just progress).
//
// All mutations call the JSON API routes. Re-match-all uses the in-memory
// jobs registry and the existing useSyncJobProgress hook.

import { useEffect, useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { TaxonomyNode } from "@prisma/client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useSyncJobProgress } from "../hooks/useSyncJobProgress";
import { TaxonomyTree } from "../components/intelligence/TaxonomyTree";
import { TaxonomyNodeEditor } from "../components/intelligence/TaxonomyNodeEditor";
import type { TaxonomyAxisOverride } from "../lib/catalog/taxonomy";
import type { StoreMode } from "../lib/catalog/store-axes";

type LoaderData = {
  nodes: TaxonomyNode[];
  storeMode: StoreMode;
};

// 006a §3.5 (multi-industry): empty-state copy adapts to the merchant's
// chosen vertical. Industry-neutral tone — never names the catalog content
// in tooltips/placeholders, only in the empty-state heading.
const EMPTY_STATE_HEADING: Record<StoreMode, string> = {
  FASHION: "Build your apparel taxonomy",
  ELECTRONICS: "Build your devices taxonomy",
  FURNITURE: "Build your furniture taxonomy",
  BEAUTY: "Build your beauty taxonomy",
  JEWELLERY: "Build your jewellery taxonomy",
  GENERAL: "Build your product taxonomy",
};

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticate.admin(request);
  const [nodes, config] = await Promise.all([
    prisma.taxonomyNode.findMany({
      where: { shopDomain: session.shop },
      orderBy: [{ position: "asc" }, { name: "asc" }],
    }),
    prisma.merchantConfig.findUnique({
      where: { shop: session.shop },
      select: { storeMode: true },
    }),
  ]);
  return {
    nodes,
    storeMode: (config?.storeMode ?? "GENERAL") as StoreMode,
  };
};

export default function TaxonomyPage() {
  const { nodes, storeMode } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  const [selectedId, setSelectedId] = useState<string | null>(
    nodes[0]?.id ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const storeModeLabel = storeMode.toLowerCase();

  const selected = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  );

  // Re-match-all job ----------------------------------------------------
  const rematchFetcher = useFetcher<{
    jobId?: string;
    error?: string;
  }>();
  const [rematchJobId, setRematchJobId] = useState<string | null>(null);
  useEffect(() => {
    if (rematchFetcher.data?.jobId) {
      setRematchJobId(rematchFetcher.data.jobId);
    }
  }, [rematchFetcher.data]);
  const rematchProgress = useSyncJobProgress(rematchJobId, {
    onSuccess: () => {
      setInfo("Re-match complete.");
      revalidator.revalidate();
    },
    onFailure: (err) => setError(err ?? "Re-match failed."),
  });
  const isRematching =
    rematchFetcher.state !== "idle" ||
    (rematchProgress.snapshot !== null &&
      (rematchProgress.snapshot.status === "running" ||
        rematchProgress.snapshot.status === "queued"));

  const triggerRematch = () => {
    setError(null);
    setInfo(null);
    rematchFetcher.submit(null, {
      method: "post",
      action: "/api/intelligence/taxonomy/rematch-all",
    });
  };

  const triggerReset = async () => {
    setError(null);
    setInfo(null);
    setConfirmReset(false);
    setResetting(true);
    try {
      const res = await fetch("/api/intelligence/taxonomy/reset", {
        method: "POST",
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        nodesCreated?: number;
        error?: string;
      } | null;
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setSelectedId(null);
      setInfo(
        `Reset to ${storeModeLabel} defaults: ${body.nodesCreated ?? 0} nodes created.`,
      );
      revalidator.revalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset taxonomy.");
    } finally {
      setResetting(false);
    }
  };

  const triggerAddNode = async (parentId: string | null) => {
    setError(null);
    setInfo(null);
    const name = window.prompt(
      parentId ? "Name of the new child node:" : "Name of the new root node:",
    );
    if (!name) return;
    try {
      const res = await fetch("/api/intelligence/taxonomy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId, name, matchKeywords: [], axisOverrides: [] }),
      });
      const body = (await res.json()) as { node?: TaxonomyNode; error?: string };
      if (!res.ok || !body.node) throw new Error(body.error ?? `HTTP ${res.status}`);
      setSelectedId(body.node.id);
      revalidator.revalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create node.");
    }
  };

  const triggerDelete = async (node: TaxonomyNode) => {
    const ok = window.confirm(
      `Delete "${node.name}"? Children will be deleted too. Products matched to this node will be unassigned (run Re-match all to reassign).`,
    );
    if (!ok) return;
    setError(null);
    try {
      const res = await fetch(`/api/intelligence/taxonomy/${node.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      if (selectedId === node.id) setSelectedId(null);
      revalidator.revalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete node.");
    }
  };

  const triggerMove = async (id: string, direction: -1 | 1) => {
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    const siblings = nodes
      .filter((n) => n.parentId === node.parentId)
      .sort((a, b) => a.position - b.position);
    const idx = siblings.findIndex((n) => n.id === id);
    const swapIdx = idx + direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= siblings.length) return;
    const swap = siblings[swapIdx];
    setError(null);
    try {
      await Promise.all([
        fetch(`/api/intelligence/taxonomy/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position: swap.position }),
        }),
        fetch(`/api/intelligence/taxonomy/${swap.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position: node.position }),
        }),
      ]);
      revalidator.revalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reorder.");
    }
  };

  const handleSaveEditor = async (input: {
    name: string;
    matchKeywords: string[];
    axisOverrides: TaxonomyAxisOverride[];
    parentId: string | null;
  }) => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/intelligence/taxonomy/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setInfo("Saved.");
      revalidator.revalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <s-page heading="Taxonomy">
      <style>{`
        .tax-page-layout { display: grid; grid-template-columns: 320px 1fr; gap: 16px; }
        @media (max-width: 900px) { .tax-page-layout { grid-template-columns: 1fr; } }
        .tax-toolbar { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
        .tax-progress { display: flex; align-items: center; gap: 8px; }
      `}</style>
      <s-stack slot="primary-action" direction="inline" gap="small-200">
        <s-button
          onClick={() => setConfirmReset(true)}
          {...(resetting ? { loading: true } : {})}
        >
          Reset to defaults
        </s-button>
        <s-button onClick={triggerRematch} {...(isRematching ? { loading: true } : {})}>
          Re-match all products
        </s-button>
      </s-stack>
      {confirmReset ? (
        <s-banner tone="warning" heading={`Reset to ${storeModeLabel} defaults?`}>
          <s-paragraph>
            This will delete your current taxonomy and replace it with the
            default tree for {storeModeLabel}. Products will be unmatched
            (Re-match all to reassign). This cannot be undone. Continue?
          </s-paragraph>
          {storeMode === "GENERAL" ? (
            <s-paragraph>
              Heads up: the general default is a clean slate — one root node
              and no children. You&apos;ll be building the tree from scratch.
            </s-paragraph>
          ) : null}
          <s-stack direction="inline" gap="small-200">
            <s-button onClick={() => setConfirmReset(false)}>Cancel</s-button>
            <s-button variant="primary" onClick={triggerReset}>
              Yes, reset
            </s-button>
          </s-stack>
        </s-banner>
      ) : null}
      {error ? (
        <s-banner tone="critical" heading="Action failed" dismissible onDismiss={() => setError(null)}>
          <s-paragraph>{error}</s-paragraph>
        </s-banner>
      ) : null}
      {info ? (
        <s-banner tone="success" dismissible onDismiss={() => setInfo(null)}>
          <s-paragraph>{info}</s-paragraph>
        </s-banner>
      ) : null}
      {isRematching && rematchProgress.snapshot ? (
        <s-section>
          <div className="tax-progress">
            <progress
              value={rematchProgress.snapshot.progress}
              max={rematchProgress.snapshot.total || 1}
            />
            <s-text color="subdued">
              {rematchProgress.snapshot.progress} / {rematchProgress.snapshot.total} matched
              {rematchProgress.etaLabel ? ` · ${rematchProgress.etaLabel}` : ""}
            </s-text>
          </div>
        </s-section>
      ) : null}
      <s-section>
        {nodes.length === 0 ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small-200">
              <s-heading>{EMPTY_STATE_HEADING[storeMode]}</s-heading>
              <s-paragraph>
                Group your products by type. Save your store type in
                Configuration to seed a default tree, or add a root category
                below to start from scratch.
              </s-paragraph>
              <s-stack direction="inline" gap="small-200">
                <s-button onClick={() => triggerAddNode(null)}>
                  Add a category
                </s-button>
              </s-stack>
            </s-stack>
          </s-box>
        ) : null}
        <div className="tax-page-layout">
          <TaxonomyTree
            nodes={nodes}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onAddChild={triggerAddNode}
            onMoveUp={(id) => triggerMove(id, -1)}
            onMoveDown={(id) => triggerMove(id, 1)}
            onDelete={triggerDelete}
          />
          {selected ? (
            <TaxonomyNodeEditor
              key={selected.id}
              node={selected}
              allNodes={nodes}
              saving={saving}
              onSave={handleSaveEditor}
            />
          ) : (
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-paragraph>Select a node to edit it.</s-paragraph>
            </s-box>
          )}
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
