// PR-2.1: unit tests for tagging-jobs.server.
//
// Mirrors the structure of cron-tick.test.ts: vi.mock the prisma
// client + sync-jobs.server, exercise the helpers in isolation.
//
// Coverage:
//   - heartbeatTaggingJob writes heartbeatAt
//   - finishTaggingJob writes status + finishedAt + summary + errorClass/message
//   - logTaggingFailure increments errorCount + writes error fields, truncates long messages
//   - sweepStuckTaggingJobs picks up RUNNING with stale heartbeat and resets to QUEUED
//   - sweepStuckTaggingJobs no-ops when nothing is stuck
//   - releaseTaggingJobToQueue: RUNNING → QUEUED, QUEUED → no-op, terminal throws
//   - cancelTaggingJobsForProduct flips QUEUED + RUNNING rows to CANCELLED
//   - resumePausedJobsForShop flips BUDGET_PAUSED → QUEUED for SINGLE_PRODUCT/MANUAL_RETAG only

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockTaggingJob, mockQueryRaw } = vi.hoisted(() => ({
  mockTaggingJob: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  mockQueryRaw: vi.fn(),
}));

vi.mock("../../db.server", () => ({
  default: {
    taggingJob: mockTaggingJob,
    $queryRaw: mockQueryRaw,
  },
}));

vi.mock("./sync-jobs.server", () => ({
  getHeartbeatTimeoutMs: () => 5 * 60 * 1000, // 5 minutes
}));

import {
  cancelTaggingJobsForProduct,
  finishTaggingJob,
  heartbeatTaggingJob,
  logTaggingFailure,
  releaseTaggingJobToQueue,
  resumePausedJobsForShop,
  sweepStuckTaggingJobs,
} from "./tagging-jobs.server";

beforeEach(() => {
  mockTaggingJob.findMany.mockReset();
  mockTaggingJob.findUnique.mockReset();
  mockTaggingJob.findFirst.mockReset();
  mockTaggingJob.update.mockReset();
  mockTaggingJob.updateMany.mockReset();
  mockQueryRaw.mockReset();
});

describe("heartbeatTaggingJob", () => {
  it("writes heartbeatAt = now()", async () => {
    mockTaggingJob.update.mockResolvedValueOnce({});
    await heartbeatTaggingJob("job-1");
    expect(mockTaggingJob.update).toHaveBeenCalledOnce();
    const call = mockTaggingJob.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "job-1" });
    expect(call.data.heartbeatAt).toBeInstanceOf(Date);
  });
});

describe("finishTaggingJob", () => {
  it("writes status + finishedAt + summary on success", async () => {
    mockTaggingJob.update.mockResolvedValueOnce({});
    await finishTaggingJob("job-1", {
      status: "SUCCEEDED",
      summary: { tagsWritten: 5 },
    });
    const call = mockTaggingJob.update.mock.calls[0][0];
    expect(call.data.status).toBe("SUCCEEDED");
    expect(call.data.finishedAt).toBeInstanceOf(Date);
    expect(call.data.summary).toEqual({ tagsWritten: 5 });
  });

  it("writes errorClass + errorMessage on failure", async () => {
    mockTaggingJob.update.mockResolvedValueOnce({});
    await finishTaggingJob("job-1", {
      status: "FAILED",
      errorClass: "RATE_LIMIT",
      errorMessage: "429 too many requests",
    });
    const call = mockTaggingJob.update.mock.calls[0][0];
    expect(call.data.status).toBe("FAILED");
    expect(call.data.errorClass).toBe("RATE_LIMIT");
    expect(call.data.errorMessage).toBe("429 too many requests");
  });

  it("supports BUDGET_PAUSED terminal state", async () => {
    mockTaggingJob.update.mockResolvedValueOnce({});
    await finishTaggingJob("job-1", {
      status: "BUDGET_PAUSED",
      errorClass: "OTHER",
      errorMessage: "Budget exceeded: DAILY_CAP",
    });
    const call = mockTaggingJob.update.mock.calls[0][0];
    expect(call.data.status).toBe("BUDGET_PAUSED");
  });
});

describe("logTaggingFailure", () => {
  it("increments errorCount and writes error fields", async () => {
    mockTaggingJob.update.mockResolvedValueOnce({});
    await logTaggingFailure({
      jobId: "job-1",
      errorClass: "MALFORMED_JSON",
      message: "Could not parse Claude response",
    });
    const call = mockTaggingJob.update.mock.calls[0][0];
    expect(call.data.errorCount).toEqual({ increment: 1 });
    expect(call.data.errorClass).toBe("MALFORMED_JSON");
    expect(call.data.errorMessage).toBe("Could not parse Claude response");
  });

  it("truncates messages longer than 1024 chars", async () => {
    mockTaggingJob.update.mockResolvedValueOnce({});
    const longMessage = "x".repeat(2000);
    await logTaggingFailure({
      jobId: "job-1",
      errorClass: "OTHER",
      message: longMessage,
    });
    const call = mockTaggingJob.update.mock.calls[0][0];
    const written: string = call.data.errorMessage;
    expect(written.length).toBe(1025); // 1024 chars + ellipsis
    expect(written.endsWith("…")).toBe(true);
  });
});

describe("sweepStuckTaggingJobs", () => {
  it("resumes RUNNING jobs with stale heartbeats", async () => {
    mockTaggingJob.findMany.mockResolvedValueOnce([
      { id: "job-1" },
      { id: "job-2" },
    ]);
    mockTaggingJob.updateMany.mockResolvedValueOnce({ count: 2 });
    const r = await sweepStuckTaggingJobs();
    expect(r.resumedJobIds).toEqual(["job-1", "job-2"]);
    const updateCall = mockTaggingJob.updateMany.mock.calls[0][0];
    expect(updateCall.data.status).toBe("QUEUED");
    expect(updateCall.data.heartbeatAt).toBe(null);
  });

  it("no-ops when nothing is stuck", async () => {
    mockTaggingJob.findMany.mockResolvedValueOnce([]);
    const r = await sweepStuckTaggingJobs();
    expect(r.resumedJobIds).toEqual([]);
    expect(mockTaggingJob.updateMany).not.toHaveBeenCalled();
  });
});

describe("releaseTaggingJobToQueue", () => {
  it("RUNNING → QUEUED", async () => {
    mockTaggingJob.findUnique.mockResolvedValueOnce({ status: "RUNNING" });
    mockTaggingJob.update.mockResolvedValueOnce({});
    const r = await releaseTaggingJobToQueue("job-1");
    expect(r.released).toBe(true);
    expect(mockTaggingJob.update).toHaveBeenCalledOnce();
    const call = mockTaggingJob.update.mock.calls[0][0];
    expect(call.data.status).toBe("QUEUED");
  });

  it("QUEUED → no-op (idempotent)", async () => {
    mockTaggingJob.findUnique.mockResolvedValueOnce({ status: "QUEUED" });
    const r = await releaseTaggingJobToQueue("job-1");
    expect(r.released).toBe(false);
    expect(mockTaggingJob.update).not.toHaveBeenCalled();
  });

  it("throws on terminal status", async () => {
    mockTaggingJob.findUnique.mockResolvedValueOnce({ status: "SUCCEEDED" });
    await expect(releaseTaggingJobToQueue("job-1")).rejects.toThrow();
  });

  it("throws when job not found", async () => {
    mockTaggingJob.findUnique.mockResolvedValueOnce(null);
    await expect(releaseTaggingJobToQueue("nope")).rejects.toThrow();
  });
});

describe("cancelTaggingJobsForProduct", () => {
  it("flips QUEUED + RUNNING rows to CANCELLED", async () => {
    mockTaggingJob.updateMany.mockResolvedValueOnce({ count: 2 });
    const r = await cancelTaggingJobsForProduct({
      shopDomain: "test.shop",
      productId: "prod-1",
    });
    expect(r.cancelledCount).toBe(2);
    const call = mockTaggingJob.updateMany.mock.calls[0][0];
    expect(call.where.shopDomain).toBe("test.shop");
    expect(call.where.productId).toBe("prod-1");
    expect(call.where.status).toEqual({ in: ["QUEUED", "RUNNING"] });
    expect(call.data.status).toBe("CANCELLED");
  });
});

describe("resumePausedJobsForShop", () => {
  it("flips BUDGET_PAUSED rows back to QUEUED for SINGLE_PRODUCT and MANUAL_RETAG only", async () => {
    mockTaggingJob.updateMany.mockResolvedValueOnce({ count: 3 });
    const r = await resumePausedJobsForShop("test.shop");
    expect(r.resumedCount).toBe(3);
    const call = mockTaggingJob.updateMany.mock.calls[0][0];
    expect(call.where.kind).toEqual({ in: ["SINGLE_PRODUCT", "MANUAL_RETAG"] });
    expect(call.where.status).toBe("BUDGET_PAUSED");
    expect(call.data.status).toBe("QUEUED");
  });
});
