// Rules admin page (006a §5.6).
//
// Loader: all rules + all taxonomy nodes (for the scope dropdown).
// Filter (All/Enabled/Disabled), search by name, Create button. Edit/Test
// in a modal-style RuleEditor card. Apply-all confirmation surfaces the
// purely-additive semantic per Decision 2.

import { useEffect, useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { TaggingRule, TaxonomyNode } from "@prisma/client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useSyncJobProgress } from "../hooks/useSyncJobProgress";
import { RuleRow } from "../components/intelligence/RuleRow";
import {
  RuleEditor,
  type RuleDraft,
  type TestResult,
} from "../components/intelligence/RuleEditor";
import type { Condition, Effect } from "../lib/catalog/rule-types";
import type { StoreMode } from "../lib/catalog/store-axes";

type LoaderData = {
  rules: TaggingRule[];
  nodes: TaxonomyNode[];
  productCount: number;
  storeMode: StoreMode;
};

// 006a §3.5: noun substitution for the rules empty-state copy. The rest of
// the page stays industry-neutral.
const EMPTY_STATE_NOUN: Record<StoreMode, string> = {
  FASHION: "apparel",
  ELECTRONICS: "devices",
  FURNITURE: "furniture",
  BEAUTY: "beauty",
  JEWELLERY: "jewellery",
  GENERAL: "products",
};

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticate.admin(request);
  const [rules, nodes, productCount, config] = await Promise.all([
    prisma.taggingRule.findMany({
      where: { shopDomain: session.shop },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    }),
    prisma.taxonomyNode.findMany({
      where: { shopDomain: session.shop },
      orderBy: { slug: "asc" },
    }),
    prisma.product.count({ where: { shopDomain: session.shop, deletedAt: null } }),
    prisma.merchantConfig.findUnique({
      where: { shop: session.shop },
      select: { storeMode: true },
    }),
  ]);
  return {
    rules,
    nodes,
    productCount,
    storeMode: (config?.storeMode ?? "GENERAL") as StoreMode,
  };
};

const EMPTY_DRAFT: RuleDraft = {
  id: null,
  name: "",
  description: "",
  enabled: true,
  priority: 100,
  taxonomyNodeId: null,
  conditions: { kind: "title_contains", value: "" },
  effects: [{ axis: "", value: "" }],
};

type FilterMode = "all" | "enabled" | "disabled";

export default function RulesPage() {
  const { rules, nodes, productCount, storeMode } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  const [filter, setFilter] = useState<FilterMode>("all");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [confirmApplyAll, setConfirmApplyAll] = useState(false);

  // Apply-all job ----------------------------------------------------
  const applyFetcher = useFetcher<{ jobId?: string; error?: string }>();
  const [applyJobId, setApplyJobId] = useState<string | null>(null);
  useEffect(() => {
    if (applyFetcher.data?.jobId) setApplyJobId(applyFetcher.data.jobId);
  }, [applyFetcher.data]);
  const applyProgress = useSyncJobProgress(applyJobId, {
    onSuccess: () => {
      setInfo("Apply-all complete.");
      revalidator.revalidate();
    },
    onFailure: (err) => setError(err ?? "Apply-all failed."),
  });
  const isApplying =
    applyFetcher.state !== "idle" ||
    (applyProgress.snapshot !== null &&
      (applyProgress.snapshot.status === "running" ||
        applyProgress.snapshot.status === "queued"));

  const enabledRulesCount = rules.filter((r) => r.enabled).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rules.filter((r) => {
      if (filter === "enabled" && !r.enabled) return false;
      if (filter === "disabled" && r.enabled) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rules, filter, search]);

  const handleToggle = async (id: string, enabled: boolean) => {
    setError(null);
    try {
      const res = await fetch(`/api/intelligence/rules/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      revalidator.revalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not toggle rule.");
    }
  };

  const handleEdit = (rule: TaggingRule) => {
    setDraft({
      id: rule.id,
      name: rule.name,
      description: rule.description ?? "",
      enabled: rule.enabled,
      priority: rule.priority,
      taxonomyNodeId: rule.taxonomyNodeId,
      conditions: rule.conditions as unknown as Condition,
      effects: rule.effects as unknown as Effect[],
    });
  };

  const handleDelete = async (rule: TaggingRule) => {
    if (!window.confirm(`Delete rule "${rule.name}"?`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/intelligence/rules/${rule.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      revalidator.revalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete rule.");
    }
  };

  const handleSaveDraft = async (built: RuleDraft) => {
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: built.name,
        description: built.description || undefined,
        enabled: built.enabled,
        priority: built.priority,
        taxonomyNodeId: built.taxonomyNodeId,
        conditions: built.conditions,
        effects: built.effects,
      };
      const res = built.id
        ? await fetch(`/api/intelligence/rules/${built.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/intelligence/rules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      if (!res.ok) {
        const r = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(r?.error ?? `HTTP ${res.status}`);
      }
      setDraft(null);
      setInfo(built.id ? "Rule updated." : "Rule created.");
      revalidator.revalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save rule.");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (built: RuleDraft, productId: string): Promise<TestResult> => {
    try {
      const res = await fetch("/api/intelligence/rules/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          rule: {
            conditions: built.conditions,
            effects: built.effects,
            taxonomyNodeId: built.taxonomyNodeId,
            priority: built.priority,
          },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        return {
          matched: false,
          tagsWritten: [],
          axesStillNeeded: [],
          error: body?.error ?? `HTTP ${res.status}`,
        };
      }
      const body = (await res.json()) as TestResult;
      return body;
    } catch (err) {
      return {
        matched: false,
        tagsWritten: [],
        axesStillNeeded: [],
        error: err instanceof Error ? err.message : "Test failed.",
      };
    }
  };

  const triggerApplyAll = () => {
    setError(null);
    setInfo(null);
    setConfirmApplyAll(false);
    applyFetcher.submit(null, {
      method: "post",
      action: "/api/intelligence/rules/apply-all",
    });
  };

  return (
    <s-page heading="Tagging rules">
      <style>{`
        .rules-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
        .rules-list { display: flex; flex-direction: column; gap: 8px; }
        .rules-progress { display: flex; align-items: center; gap: 8px; }
      `}</style>

      <s-stack slot="primary-action" direction="inline" gap="small-200">
        <s-button
          onClick={() => setConfirmApplyAll(true)}
          {...(isApplying ? { loading: true } : {})}
        >
          Apply all rules
        </s-button>
        <s-button variant="primary" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
          Create rule
        </s-button>
      </s-stack>

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

      {confirmApplyAll ? (
        <s-banner tone="warning" heading="Apply all enabled rules?">
          <s-paragraph>
            This will run {enabledRulesCount} enabled rule
            {enabledRulesCount === 1 ? "" : "s"} across {productCount} products
            and add tags to axes that don&apos;t already have a value. Existing
            tags will not be changed. Locked HUMAN tags will not be touched. Continue?
          </s-paragraph>
          <s-stack direction="inline" gap="small-200">
            <s-button onClick={() => setConfirmApplyAll(false)}>Cancel</s-button>
            <s-button variant="primary" onClick={triggerApplyAll}>
              Yes, apply
            </s-button>
          </s-stack>
        </s-banner>
      ) : null}

      {isApplying && applyProgress.snapshot ? (
        <s-section>
          <div className="rules-progress">
            <progress
              value={applyProgress.snapshot.progress}
              max={applyProgress.snapshot.total || 1}
            />
            <s-text color="subdued">
              {applyProgress.snapshot.progress} / {applyProgress.snapshot.total}
              {applyProgress.etaLabel ? ` · ${applyProgress.etaLabel}` : ""}
            </s-text>
          </div>
        </s-section>
      ) : null}

      <s-section>
        <div className="rules-toolbar">
          <s-select
            value={filter}
            label="Filter"
            label-accessibility-visibility="exclusive"
            onChange={(e: Event) => {
              setFilter((e.currentTarget as HTMLSelectElement).value as FilterMode);
            }}
          >
            <s-option value="all">All</s-option>
            <s-option value="enabled">Enabled</s-option>
            <s-option value="disabled">Disabled</s-option>
          </s-select>
          <s-search-field
            label="Search rules"
            label-accessibility-visibility="exclusive"
            placeholder="Search by name…"
            value={search}
            onInput={(e: Event) => setSearch((e.currentTarget as HTMLInputElement).value)}
          />
          <s-text color="subdued">
            {filtered.length} of {rules.length} rules
          </s-text>
        </div>

        <div className="rules-list">
          {rules.length === 0 ? (
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small-200">
                <s-heading>
                  Set up rules to auto-tag your {EMPTY_STATE_NOUN[storeMode]} products
                </s-heading>
                <s-paragraph>
                  Tag products with attributes that matter for filtering. Rules
                  run before AI tagging, fill gaps deterministically, and never
                  overwrite existing values.
                </s-paragraph>
                <s-stack direction="inline" gap="small-200">
                  <s-button variant="primary" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
                    Create your first rule
                  </s-button>
                </s-stack>
              </s-stack>
            </s-box>
          ) : filtered.length === 0 ? (
            <s-paragraph>No rules match these filters.</s-paragraph>
          ) : (
            filtered.map((r) => (
              <RuleRow
                key={r.id}
                rule={r}
                onToggle={handleToggle}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
      </s-section>

      {draft ? (
        <s-section>
          <RuleEditor
            draft={draft}
            taxonomyNodes={nodes}
            saving={saving}
            onCancel={() => setDraft(null)}
            onSave={handleSaveDraft}
            onTest={handleTest}
          />
        </s-section>
      ) : null}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
