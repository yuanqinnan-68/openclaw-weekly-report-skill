import type { ReportTaskRow, StatusTag } from "./project-analysis-service.js";

export interface ProjectBlock { projectName: string; tasks: ReportTaskRow[]; }
export interface WeeklyReportData {
  weekTitle: string;
  highlights: string[];
  risks: string[];
  projects: ProjectBlock[];
  nextFocus: string[];
}

const STATUS_ORDER: Record<StatusTag, number> = {
  done: 0,
  stuck: 1,
  debug: 2,
  docking: 3,
  design: 4,
  doing: 5,
  todo: 6,
};

export function stableSortByStatus(tasks: ReportTaskRow[]): ReportTaskRow[] {
  return tasks
    .map((task, originalIndex) => ({ task, originalIndex }))
    .sort((a, b) => STATUS_ORDER[a.task.statusTag] - STATUS_ORDER[b.task.statusTag]
      || a.originalIndex - b.originalIndex)
    .map(({ task }) => task);
}

export function renderProjectRows(project: ProjectBlock): string {
  return stableSortByStatus(project.tasks).map((task) => `<tr>
  <td>${escapeHtml(task.taskName)}</td>
  <td class="owner-cell">${escapeHtml(task.owner)}</td>
  <td class="status-cell"><span class="tag ${task.statusTag}" title="${escapeHtml(task.status)}">${task.statusIcon}</span></td>
  <td>${escapeHtml(task.progress)}</td>
  <td>${escapeHtml(task.nextPlan)}</td>
</tr>`).join("\n");
}

export function renderProjects(projects: ProjectBlock[]): string {
  return projects.map((project) => `<section class="project-card">
  <h2>${escapeHtml(project.projectName)}</h2>
  <table>
    <thead><tr><th>任务</th><th>负责人</th><th>状态</th><th>本周进展</th><th>下周计划</th></tr></thead>
    <tbody>${renderProjectRows(project)}</tbody>
  </table>
</section>`).join("\n");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
