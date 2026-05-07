// PR-3.1-mech.6: RE_EMBED handler tests.
//
// Pattern: vi.hoisted-mocked prisma + voyage helper + tagging-jobs +
// logger. Asserts Decision A's skip predicate (hash match → no Voyage,
// status=SUCCEEDED with summary.skipped=true) and the happy path
// (Voyage called, embedding + hash + updatedAt updated atomically,
// cost recorded with the helper's micro value).

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaggingJob } from "@prisma/client";

const {
  productFindFirst,
  merchantConfigFindUnique,
  taggingJobUpdate,
  executeRaw,
  embedDocumentWithUsage,
  finishTaggingJob,
  heartbeatTaggingJob,
  updateTaggingProgress,
  logTaggingFailure,
  mockLog,
} = vi.hoisted(() => ({
  productFindFirst: vi.fn(),
  merchantConfigFindUnique: vi.fn(),
  taggingJobUpdate: vi.fn(),
  executeRaw: vi.fn(),
  embedDocumentWithUsage: vi.fn(),
  finishTaggingJob: vi.fn(),
  heartbeatTaggingJob: vi.fn(),
  updateTaggingProgress: vi.fn(),
  logTaggingFailure: vi.fn(),
  mockLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../db.server", () => ({
  default: {
    product: { findFirst: productFindFirst },
    merchantConfig: { findUnique: merchantConfigFindUnique },
    taggingJob: { update: taggingJobUpdate },
    $executeRaw: executeRaw,
  },
}));

vi.mock("../lib/embeddings/voyage.server", () => ({
  embedDocumentWithUsage,
}));

vi.mock("../lib/catalog/tagging-jobs.server", () => ({
  finishTaggingJob,
  heartbeatTaggingJob,
  updateTaggingProgress,
  logTaggingFailure,
}));

vi.mock("./worker-logger", () => ({ log: mockLog }));

import { processReEmbedJob } from "./worker-reembed";

function makeJob(overrides: Partial<TaggingJob> = {}): TaggingJob {
  return {
    id: "job-1",
    shopDomain: "test.shop",
    productId: "prod-1",
    kind: "RE_EMBED",
    status: "RUNNING",
    triggerSource: "MANUAL",
    enqueuedAt: new Date(),
    startedAt: new Date(),
    finishedAt: null,
    heartbeatAt: new Date(),
    totalProducts: null,
    processedProducts: 0,
    failedProducts: 0,
    skippedProducts: 0,
    costUsdMicros: 0n,
    inputTokens: 0,
    outputTokens: 0,
    errorClass: null,
    errorMessage: null,
    errorCount: 0,
    summary: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TaggingJob;
}

const baseProduct = {
  id: "prod-1",
  title: "Linen Shirt",
  descriptionHtml: "<p>A shirt.</p>",
  productType: "shirt",
  vendor: "VendorA",
  shopifyTags: ["linen"],
  knowledgeContentHash: "hash-A",
  embeddingContentHash: "hash-A",
  tags: [{ axis: "category", value: "shirt" }],
};

beforeEach(() => {
  productFindFirst.mockReset();
  merchantConfigFindUnique.mockReset();
  taggingJobUpdate.mockReset();
  executeRaw.mockReset();
  embedDocumentWithUsage.mockReset();
  finishTaggingJob.mockReset();
  heartbeatTaggingJob.mockReset();
  updateTaggingProgress.mockReset();
  logTaggingFailure.mockReset();
  mockLog.info.mockReset();
  mockLog.warn.mockReset();
  mockLog.error.mockReset();

  merchantConfigFindUnique.mockResolvedValue({ storeMode: "FASHION" });
  taggingJobUpdate.mockResolvedValue({});
  executeRaw.mockResolvedValue(1);
  finishTaggingJob.mockResolvedValue(undefined);
  heartbeatTaggingJob.mockResolvedValue(undefined);
  updateTaggingProgress.mockResolvedValue(undefined);
  logTaggingFailure.mockResolvedValue(undefined);
});

describe("processReEmbedJob — Decision A skip predicate", () => {
  it("hash match → marks SUCCEEDED with skipped=true, no Voyage call, no embedding write", async () => {
    productFindFirst.mockResolvedValue({
      ...baseProduct,
      knowledgeContentHash: "hash-A",
      embeddingContentHash: "hash-A",
    });

    const result = await processReEmbedJob({ job: makeJob() });

    expect(result.outcome).toBe("skipped");
    expect(embedDocumentWithUsage).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
    expect(taggingJobUpdate).not.toHaveBeenCalled(); // no cost recording

    expect(finishTaggingJob).toHaveBeenCalledTimes(1);
    const finishCall = finishTaggingJob.mock.calls[0];
    expect(finishCall[1].status).toBe("SUCCEEDED");
    expect(finishCall[1].summary).toMatchObject({
      kind: "RE_EMBED",
      outcome: "skipped",
      skipped: true,
      reason: "hash-match",
    });
  });
});

describe("processReEmbedJob — happy path (hash differs)", () => {
  it("hash mismatch → calls Voyage, writes embedding + hash, records cost, marks SUCCEEDED with skipped=false", async () => {
    productFindFirst.mockResolvedValue({
      ...baseProduct,
      knowledgeContentHash: "hash-NEW",
      embeddingContentHash: "hash-OLD",
    });
    embedDocumentWithUsage.mockResolvedValue({
      embedding: new Array(1024).fill(0.1),
      tokens: 1000, // → 60 micros via the cost helper
    });

    const result = await processReEmbedJob({ job: makeJob() });

    expect(result.outcome).toBe("succeeded");
    expect(result.tokens).toBe(1000);
    expect(result.costMicros).toBe(60);

    // Voyage called with the built embedding text.
    expect(embedDocumentWithUsage).toHaveBeenCalledTimes(1);
    const embedCall = embedDocumentWithUsage.mock.calls[0];
    expect(typeof embedCall[0]).toBe("string");
    expect(embedCall[0]).toContain("Linen Shirt");

    // Embedding + hash + updatedAt update via $executeRaw.
    expect(executeRaw).toHaveBeenCalledTimes(1);

    // Cost recording on the TaggingJob row.
    expect(taggingJobUpdate).toHaveBeenCalledTimes(1);
    const updateCall = taggingJobUpdate.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: "job-1" });
    expect(updateCall.data.costUsdMicros).toEqual({ increment: 60n });
    expect(updateCall.data.inputTokens).toEqual({ increment: 1000 });

    // Terminal status.
    expect(finishTaggingJob).toHaveBeenCalledTimes(1);
    const finishCall = finishTaggingJob.mock.calls[0];
    expect(finishCall[1].status).toBe("SUCCEEDED");
    expect(finishCall[1].summary).toMatchObject({
      kind: "RE_EMBED",
      outcome: "succeeded",
      skipped: false,
      tokens: 1000,
      costMicros: 60,
    });
  });

  it("NULL embeddingContentHash → treated as needs-embed (Voyage called)", async () => {
    productFindFirst.mockResolvedValue({
      ...baseProduct,
      knowledgeContentHash: "hash-A",
      embeddingContentHash: null,
    });
    embedDocumentWithUsage.mockResolvedValue({
      embedding: new Array(1024).fill(0.2),
      tokens: 500,
    });

    const result = await processReEmbedJob({ job: makeJob() });

    expect(result.outcome).toBe("succeeded");
    expect(result.tokens).toBe(500);
    expect(result.costMicros).toBe(30);
    expect(embedDocumentWithUsage).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });
});

describe("processReEmbedJob — failure paths", () => {
  it("missing productId → marks FAILED without touching Voyage", async () => {
    const result = await processReEmbedJob({
      job: makeJob({ productId: null }),
    });
    expect(result.outcome).toBe("failed");
    expect(productFindFirst).not.toHaveBeenCalled();
    expect(embedDocumentWithUsage).not.toHaveBeenCalled();
    expect(finishTaggingJob).toHaveBeenCalledOnce();
    expect(finishTaggingJob.mock.calls[0][1].status).toBe("FAILED");
  });

  it("Voyage call throws → marks FAILED with errorClass, no embedding write", async () => {
    productFindFirst.mockResolvedValue({
      ...baseProduct,
      knowledgeContentHash: "hash-NEW",
      embeddingContentHash: null,
    });
    embedDocumentWithUsage.mockRejectedValue(
      new Error("Voyage embeddings request failed (status 500): boom"),
    );

    const result = await processReEmbedJob({ job: makeJob() });

    expect(result.outcome).toBe("failed");
    expect(executeRaw).not.toHaveBeenCalled();
    expect(finishTaggingJob).toHaveBeenCalledOnce();
    const finishCall = finishTaggingJob.mock.calls[0];
    expect(finishCall[1].status).toBe("FAILED");
    expect(finishCall[1].errorClass).toBe("CONNECTION");
  });
});
