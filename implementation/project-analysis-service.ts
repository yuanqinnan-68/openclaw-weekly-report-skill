/**
 * OpenClaw weekly-report summarization reference implementation.
 * This file is deliberately independent from database and tenant code so the
 * report rules can be optimized and tested without production credentials.
 */

export interface SourceTask {
  id: string;
  project: string;
  taskName: string;
  owner: string;
  period: string;
  status: string;
  progress: string;
  nextPlan: string;
  risk: string;
  sourceIndex: number;
}

export interface RefinedTaskText {
  taskName: string;
  progress: string;
  nextPlan: string;
}

export interface ReportTaskRow extends SourceTask, RefinedTaskText {
  statusTag: StatusTag;
  statusIcon: string;
}

export interface OwnerSummary {
  owner: string;
  summary: string;
}

export type StatusTag = "done" | "stuck" | "debug" | "docking" | "design" | "doing" | "todo";

export function cleanSourceText(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Every source row receives a unique ID. Similar or identical rows remain separate. */
export function normalizeSourceRows(rows: Array<Partial<SourceTask>>): SourceTask[] {
  const usedIds = new Set<string>();
  return rows.map((row, sourceIndex) => {
    const base = cleanSourceText(row.id) || `row-${sourceIndex}`;
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) id = `${base}#${suffix++}`;
    usedIds.add(id);
    return {
    id,
    project: cleanSourceText(row.project) || "未分类",
    taskName: cleanSourceText(row.taskName),
    owner: cleanSourceText(row.owner),
    period: cleanSourceText(row.period) || "本周内容",
    status: cleanSourceText(row.status) || "待开始",
    progress: cleanSourceText(row.progress),
    nextPlan: cleanSourceText(row.nextPlan),
    risk: cleanSourceText(row.risk),
    sourceIndex,
    };
  });
}

export function buildRefinementPrompt(rows: SourceTask[]): string {
  const input = rows.map((row) => ({
    id: row.id,
    project: row.project,
    task_name: row.taskName,
    owner: row.owner,
    status: row.status,
    this_week: row.progress,
    next_week: row.nextPlan,
  }));

  return `你是团队周报编辑。请把下面飞书任务改写成适合邮件阅读的极简中文摘要，不要逐字抄写，也不要遗漏核心事实。

规则：
1. 每个 id 必须输出一条，不能合并、不能丢失。
2. 只改写 task_name、progress、next_plan；status、project、owner 不得臆造。
3. progress 只回答“本周完成了什么、结果是什么”，控制在20-50字，最多一句话。
4. next_plan 只回答“下一步做什么”，控制在15-40字，最多一句话。
5. 删除过程步骤、重复背景、过多技术参数和清单编号；保留关键名称、数字、版本和结果。
6. task_name 控制在8-30字，不改变任务含义。
7. 没有内容的字段输出空字符串，不要输出“暂无”。
8. 不要使用省略号，不要截断半句话，不要补充输入中没有的事实。
9. 只返回JSON：{"tasks":[{"id":"原id","task_name":"...","progress":"...","next_plan":"..."}]}。

任务数据：
${JSON.stringify(input)}`;
}

function containsInvalidText(text: string): boolean {
  return text.includes("…") || text.includes("...") || /(?:^|[\n；;])\s*\d+[、.．)）]/.test(text);
}

/** Reject incomplete model output per row and fall back to the complete source text. */
export function applyRefinement(rows: SourceTask[], modelItems: unknown): ReportTaskRow[] {
  const items = Array.isArray(modelItems) ? modelItems : [];
  const byId = new Map<string, any>();
  for (const item of items) {
    if (item && typeof item.id === "string" && !byId.has(item.id)) byId.set(item.id, item);
  }

  return rows.map((row) => {
    const item = byId.get(row.id);
    const taskName = cleanSourceText(item?.task_name) || row.taskName;
    const progress = cleanSourceText(item?.progress) || row.progress;
    const nextPlan = cleanSourceText(item?.next_plan) || row.nextPlan;
    const valid = progress.length <= 70 && nextPlan.length <= 60
      && !containsInvalidText(progress) && !containsInvalidText(nextPlan);

    return {
      ...row,
      taskName: valid ? taskName : row.taskName,
      progress: valid ? progress : row.progress,
      nextPlan: valid ? nextPlan : row.nextPlan,
      statusTag: statusTag(row.status),
      statusIcon: statusIcon(row.status),
    };
  });
}

type HighlightKind = "delivery" | "design" | "research" | "collab" | "ops" | "process" | "other";

function highlightKind(row: SourceTask): HighlightKind {
  const text = `${row.taskName} ${row.progress}`;
  if (/(上线|发布|交付|合入|投产)/.test(text)) return "delivery";
  if (/(设计|评审|方案|原型|视觉)/.test(text)) return "design";
  if (/(调研|对比|分析|实验|竞品)/.test(text)) return "research";
  if (/(对接|沟通|对齐|协同|会议)/.test(text)) return "collab";
  if (/(修复|故障|排查|回滚|告警|bug)/i.test(text)) return "ops";
  if (/(流程|规范|文档|基建|模板)/.test(text)) return "process";
  return "other";
}

/** Cap length and penalize step lists so process dumps do not outrank shorter results. */
function highlightRankScore(row: SourceTask): number {
  const text = row.progress || row.taskName;
  const processDump = /(?:^|[\n；;])\s*\d+[、.．)）]/.test(text);
  const resultSignal = /(完成|交付|上线|发布|落地|结论|修复|解决|确定|验证|通过|建立|产出|推进)/.test(text) ? 12 : 0;
  return resultSignal + (/\d/.test(text) ? 2 : 0) + (processDump ? -10 : 0);
}

/**
 * Team-level highlights: pick results, not a per-person roster.
 * Owner coverage belongs to owner summaries. Same owner at most once.
 */
export function selectHighlightCandidates(rows: SourceTask[], limit = 5): SourceTask[] {
  const candidates = rows
    .filter((row) => row.period !== "下周规划" && row.status.includes("已完成"))
    .filter((row) => Boolean(row.progress || row.taskName))
    .slice()
    .sort((a, b) => highlightRankScore(b) - highlightRankScore(a) || a.sourceIndex - b.sourceIndex);

  const selected: SourceTask[] = [];
  const usedIds = new Set<string>();
  const usedOwners = new Set<string>();
  const usedKinds = new Set<HighlightKind>();
  const usedProjects = new Set<string>();

  const take = (pred: (row: SourceTask) => boolean): boolean => {
    const next = candidates.find((row) =>
      !usedIds.has(row.id) && !usedOwners.has(row.owner) && pred(row)
    );
    if (!next) return false;
    usedIds.add(next.id);
    usedOwners.add(next.owner);
    usedKinds.add(highlightKind(next));
    usedProjects.add(next.project);
    selected.push(next);
    return true;
  };

  while (selected.length < limit) {
    const progressed =
      take((row) => !usedKinds.has(highlightKind(row)) && !usedProjects.has(row.project))
      || take((row) => !usedKinds.has(highlightKind(row)))
      || take((row) => !usedProjects.has(row.project))
      || take(() => true);
    if (!progressed) break;
  }

  return selected;
}

export function buildHighlightPrompt(row: SourceTask): string {
  const source = `${row.project ? `${row.project}：` : ""}${row.taskName}。${row.progress}`;
  return `请把下面一条已完成任务整理成一句简短的周报亮点，约30-60字。这是团队速览，不是全员名单。亮点不限于上线或发布：设计结论、调研发现、协作推进、排障修复、流程改进只要有结果都要写出来，不要改写成同一种「交付上线」口吻。只保留项目、关键动作和结果，删除过程清单与重复细节，不要逐字抄写，不要编造事实，不要省略号，不要编号，只返回一句完整中文。\n${source}`;
}

export function groupTasksByOwner(rows: SourceTask[]): Map<string, SourceTask[]> {
  const map = new Map<string, SourceTask[]>();
  for (const row of rows) {
    if (row.period === "下周规划") continue;
    if (!row.owner.trim()) continue;
    const bucket = map.get(row.owner);
    if (bucket) {
      bucket.push(row);
    } else {
      map.set(row.owner, [row]);
    }
  }
  return map;
}

export function fallbackOwnerSummary(tasks: SourceTask[]): string {
  return tasks
    .map((task) => cleanSourceText(task.progress))
    .filter(Boolean)
    .join("；");
}

export function buildOwnerSummaryPrompt(owner: string, tasks: SourceTask[]): string {
  const items = tasks.map((t) => `- 任务：${t.taskName}\n  状态：${t.status}\n  本周进展：${t.progress}\n  风险：${t.risk}\n  下周计划：${t.nextPlan}`).join("\n");
  return `请把下面这位成员本周的工作整理成一句简洁的中文概述，约20-40字。这是全员覆盖的工作摘要，不是亮点榜，不要拔高，也不要只挑最好看的一项。必须结合每条任务的状态：已完成说结果，推进中说进展，卡住如实写阻塞，不要把未完成写成已完成。只说做了什么和关键结果，不要省略号，不要编号，不要编造事实，只返回一句完整中文。\n成员：${owner}\n本周工作：\n${items}`;
}

/** Prepare one model request per owner; callers can execute these requests in their AI adapter. */
export function buildOwnerSummaryRequests(groups: Map<string, SourceTask[]>): Array<{ owner: string; prompt: string }> {
  return [...groups.entries()].map(([owner, tasks]) => ({ owner, prompt: buildOwnerSummaryPrompt(owner, tasks) }));
}

function ownerSummaryInvalid(text: string): boolean {
  return !text || text.length > 60 || containsInvalidText(text) || /```|\{\s*"/.test(text);
}

/** Align model summaries to every owner and use complete source text on malformed output. */
export function applyOwnerSummaries(groups: Map<string, SourceTask[]>, modelItems: unknown): OwnerSummary[] {
  const items = Array.isArray(modelItems) ? modelItems : [];
  const byOwner = new Map<string, string>();
  for (const item of items) {
    if (item && typeof item.owner === "string" && typeof item.summary === "string" && !byOwner.has(item.owner)) {
      byOwner.set(item.owner, cleanSourceText(item.summary));
    }
  }
  return [...groups.entries()].map(([owner, tasks]) => {
    const summary = byOwner.get(owner) || "";
    return { owner, summary: ownerSummaryInvalid(summary) ? fallbackOwnerSummary(tasks) : summary };
  });
}

export function statusTag(status: string): StatusTag {
  if (status.includes("已完成")) return "done";
  if (status.includes("卡住")) return "stuck";
  if (status.includes("调试")) return "debug";
  if (status.includes("对接")) return "docking";
  if (status.includes("设计")) return "design";
  if (/(推进|开发|测试|部署|联调|验收|调研|撰写|重构|优化|实施|沟通)中/.test(status)) return "doing";
  return "todo";
}

export function statusIcon(status: string): string {
  return ({ done: "✅", stuck: "🚫", debug: "🔧", docking: "🤝", design: "🎨", doing: "▶️", todo: "⏳" } as const)[statusTag(status)];
}
