// Copyright 2026 Cole Munz
// SPDX-License-Identifier: AGPL-3.0-only

export type DateParts = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}>;

export type GetDateParts = (epochMs: number) => DateParts;

export const getLocalDateParts: GetDateParts = epochMs => {
  const date = new Date(epochMs);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
};

/** @testexport */
export const getUtcDateParts: GetDateParts = epochMs => {
  const date = new Date(epochMs);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
};

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function formatDate(parts: DateParts): string {
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function formatDateTime(parts: DateParts): string {
  return `${formatDate(parts)} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function formatCompactDateTime(parts: DateParts): string {
  return `${formatDate(parts)} ${pad(parts.hour)}${pad(parts.minute)}`;
}

export function toIsoUtc(epochMs: number): string {
  if (!Number.isFinite(epochMs)) {
    return new Date(0).toISOString();
  }
  return new Date(epochMs).toISOString();
}

const DURATION_UNITS: ReadonlyArray<readonly [number, string]> = [
  [7 * 24 * 60 * 60, 'w'],
  [24 * 60 * 60, 'd'],
  [60 * 60, 'h'],
  [60, 'm'],
  [1, 's'],
];

export function formatTimer(seconds: number): string {
  for (const [unitSeconds, suffix] of DURATION_UNITS) {
    if (seconds >= unitSeconds && seconds % unitSeconds === 0) {
      return `${seconds / unitSeconds}${suffix}`;
    }
  }
  return `${Math.max(0, Math.round(seconds))}s`;
}
