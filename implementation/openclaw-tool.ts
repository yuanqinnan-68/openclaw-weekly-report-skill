/** Reference OpenClaw tool contract. The bridge URL and credentials stay in deployment configuration. */
export const generateWeeklyReportTool = {
  name: "generate_weekly_report",
  label: "生成周报（一步完成，含发送）",
  description: "生成周报的唯一工具：同步飞书、AI整理、结构校验、状态排序、渲染HTML并可选发送邮件。不要再组合调用同步、分析和独立发邮件工具。",
  parameters: {
    type: "object",
    properties: {
      to: { type: "string", description: "收件人邮箱" },
      subject: { type: "string", description: "邮件主题（可选）" },
      week_date: { type: "string", description: "周日期 YYYY-MM-DD；未指定则使用最新周" },
    },
  },
} as const;
