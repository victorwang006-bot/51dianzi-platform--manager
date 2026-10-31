import React from "react";

type NoteRow = {
  id: number;
  noteCount?: number | null;
  latestNote?: {
    id: number;
    content: string;
    authorName: string | null;
    updatedAt: string;
  } | null;
  /** Historical inventory note, which has no author or timestamp metadata. */
  note?: string | null;
};

export type NotesSummaryCompactProps = {
  row: NoteRow;
  onOpen: () => void;
  disabled?: boolean;
};

type ShanghaiTime = {
  short: string;
  full: string;
};

/**
 * `updatedAt` belongs to the latest shared note. Inventory `updatedAt` is
 * deliberately not available to this component, so it cannot be substituted
 * for a missing note timestamp.
 */
function formatShanghaiTime(value: string | null | undefined): ShanghaiTime | null {
  if (typeof value !== "string" || !value.trim()) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const byType = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value;
  const year = byType("year");
  const month = byType("month");
  const day = byType("day");
  const hour = byType("hour");
  const minute = byType("minute");
  const second = byType("second");

  if (!year || !month || !day || !hour || !minute || !second) return null;

  return {
    short: `${month}/${day} ${hour}:${minute}`,
    full: `${year}/${month}/${day} ${hour}:${minute}:${second}`,
  };
}

function knownAuthor(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function latestTitle(summary: string, author: string, time: ShanghaiTime | null) {
  return [summary, author, time?.full].filter(Boolean).join(" · ") || undefined;
}

/**
 * A list-only entry point for the existing NotesPanel. It intentionally has no
 * data hook: the inventory list has already supplied the aggregate row DTO.
 */
export function NotesSummaryCompact({
  row,
  onOpen,
  disabled = false,
}: NotesSummaryCompactProps) {
  const latest = row.latestNote ?? null;
  const historicalSummary = row.note?.trim() ?? "";

  if (!latest && !historicalSummary) {
    return (
      <div className="ci-compact-notes">
        <button
          type="button"
          className="ci-compact-notes-open ci-compact-notes-empty"
          onClick={onOpen}
          disabled={disabled}
          aria-label={`打开库存 ${row.id} 的备注`}
        >
          暂无备注
        </button>
      </div>
    );
  }

  if (!latest) {
    return (
      <div className="ci-compact-notes">
        <button
          type="button"
          className="ci-compact-notes-open ci-compact-notes-historical"
          onClick={onOpen}
          disabled={disabled}
          aria-label={`打开库存 ${row.id} 的备注`}
          title={historicalSummary}
        >
          <span className="ci-compact-notes-history" aria-hidden="true">
            历史
          </span>
          <span className="ci-compact-notes-summary">{historicalSummary}</span>
        </button>
      </div>
    );
  }

  const summary = latest.content;
  const author = knownAuthor(latest.authorName);
  const time = formatShanghaiTime(latest.updatedAt);

  return (
    <div className="ci-compact-notes">
      <button
        type="button"
        className="ci-compact-notes-open"
        onClick={onOpen}
        disabled={disabled}
        aria-label={`打开库存 ${row.id} 的备注`}
        title={latestTitle(summary, author, time)}
      >
        <span className="ci-compact-notes-summary">{summary}</span>
        {time ? (
          <time className="ci-compact-notes-time" dateTime={latest.updatedAt}>
            {time.short}
          </time>
        ) : null}
      </button>
    </div>
  );
}
