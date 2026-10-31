export const FORUM_REPORT_SHARE_PREFIX = "\uE10051_REPORT_V1\uE101";

export type ForumReportShareInput = {
  slug: string;
  title: string;
};

export type SharedReportEnvelope = {
  slug: string;
  title: string;
  note: string;
};

export function encodeSharedReportContent(report: ForumReportShareInput, note: string) {
  return [FORUM_REPORT_SHARE_PREFIX, report.slug, report.title, note.trim()].filter(Boolean).join("\n");
}

export function parseSharedReportContent(content: string): SharedReportEnvelope | null {
  const lines = content.split("\n");
  if (lines[0] !== FORUM_REPORT_SHARE_PREFIX || !lines[1] || !lines[2]) return null;
  const slug = lines[1].trim();
  if (!/^[a-z0-9][a-z0-9-]{2,127}$/.test(slug)) return null;
  return {
    slug,
    title: lines[2].trim(),
    note: lines.slice(3).join("\n").trim(),
  };
}

export function startsWithForumReportSharePrefix(content: string) {
  return content.startsWith(FORUM_REPORT_SHARE_PREFIX);
}
