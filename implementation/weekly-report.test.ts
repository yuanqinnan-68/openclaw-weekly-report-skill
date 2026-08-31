import { describe, expect, it } from "vitest";
import {
  applyOwnerSummaries,
  buildOwnerSummaryPrompt,
  normalizeSourceRows,
} from "./project-analysis-service.js";
import { renderWeeklyReport } from "./weekly-report-renderer.js";

describe("owner contribution summaries", () => {
  it("includes status and risk context in the owner prompt", () => {
    const [row] = normalizeSourceRows([{
      id: "1", owner: "张三", taskName: "接口排障", project: "项目A",
      status: "卡住", progress: "定位到超时问题", risk: "等待外部依赖", nextPlan: "继续排查",
    }]);
    const prompt = buildOwnerSummaryPrompt("张三", [row]);
    expect(prompt).toContain("卡住");
    expect(prompt).toContain("等待外部依赖");
    expect(prompt).toContain("继续排查");
  });

  it("validates model output and falls back without truncating a sentence", () => {
    const rows = normalizeSourceRows([{ id: "1", owner: "张三", taskName: "接口排障", progress: "定位问题" }]);
    const summaries = applyOwnerSummaries(new Map([["张三", rows]]), [{ owner: "张三", summary: "1. 不合规…" }]);
    expect(summaries).toEqual([{ owner: "张三", summary: "定位问题" }]);
  });

  it("falls back to empty string instead of inventing a placeholder", () => {
    const rows = normalizeSourceRows([{ id: "1", owner: "张三", taskName: "", progress: "" }]);
    const summaries = applyOwnerSummaries(new Map([["张三", rows]]), []);
    expect(summaries).toEqual([{ owner: "张三", summary: "" }]);
  });

  it("keeps owner summary blank when progress is blank", () => {
    const rows = normalizeSourceRows([{ id: "1", owner: "张三", taskName: "接口排障", progress: "" }]);
    const summaries = applyOwnerSummaries(new Map([["张三", rows]]), [{ owner: "张三", summary: "…" }]);
    expect(summaries).toEqual([{ owner: "张三", summary: "" }]);
  });

  it("makes duplicate source ids unique for row alignment", () => {
    const rows = normalizeSourceRows([
      { id: "same", owner: "甲", taskName: "任务一" },
      { id: "same", owner: "乙", taskName: "任务二" },
    ]);
    expect(rows.map((row) => row.id)).toEqual(["same", "same#2"]);
  });

  it("renders member contributions immediately after highlights", () => {
    const html = renderWeeklyReport("<main>{{highlights}}{{owner_summaries}}{{risks}}{{projects}}{{next_focus}}</main>", {
      weekTitle: "周报",
      highlights: ["1. 完成接口交付"],
      ownerSummaries: [{ owner: "张三", summary: "完成接口排障" }],
      risks: ["无"],
      projects: [],
      nextFocus: [],
    });
    expect(html.indexOf("完成接口交付")).toBeLessThan(html.indexOf("成员贡献"));
    expect(html).toContain("张三");
  });
});
