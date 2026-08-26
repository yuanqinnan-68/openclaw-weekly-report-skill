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
  return rows.map((row, sourceIndex) => ({
    id: cleanSourceText(row.id) || `row-${sourceIndex}`,
    project: cleanSourceText(row.project) || "未分类",
    taskName: cleanSourceText(row.taskName),
    owner: cleanSourceText(row.owner),
    period: cleanSourceText(row.period) || "本周内容",
    status: cleanSourceText(row.status) || "待开始",
    progress: cleanSourceText(row.progress),
    nextPlan: cleanSourceText(row.nextPlan),
    risk: cleanSourceText(row.risk),
    sourceIndex,
  }));
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

export function selectHighlightCandidates(rows: SourceTask[], limit = 5): SourceTask[] {
  return rows
    .filter((row) => row.period !== "下周规划" && row.status.includes("已完成"))
    .filter((row) => Boolean(row.progress || row.taskName))
    .map((row, originalIndex) => ({ row, originalIndex }))
    .sort((a, b) => (b.row.progress.length - a.row.progress.length) || (a.originalIndex - b.originalIndex))
    .slice(0, limit)
    .map(({ row }) => row);
}

export function buildHighlightPrompt(row: SourceTask): string {
  const source = `${row.project ? `${row.project}：` : ""}${row.taskName}。${row.progress}`;
  return `请把下面一条已完成任务整理成一句简短的周报亮点，约30-60字。只保留项目、关键动作和结果，删除过程清单与重复细节，不要逐字抄写，不要编造事实，不要省略号，不要编号，只返回一句完整中文。\n${source}`;
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
