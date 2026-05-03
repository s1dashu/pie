import { CronExpressionParser } from "cron-parser";

export interface TimeWindow {
	startAt?: string;
	endAt?: string;
}

export interface IntervalTrigger extends TimeWindow {
	type: "interval";
	everySec: number;
}

export interface CronTrigger extends TimeWindow {
	type: "cron";
	cron: string;
}

export interface OnceTrigger {
	type: "once";
	runAt: string;
}

export function parseDateTimeToMs(value: string | undefined): number | undefined {
	if (!value) {
		return undefined;
	}
	const timeMs = Date.parse(value);
	return Number.isFinite(timeMs) ? timeMs : undefined;
}

export function isBeforeScheduleStart(trigger: TimeWindow, nowMs: number): boolean {
	const startAtMs = parseDateTimeToMs(trigger.startAt);
	return startAtMs != null && nowMs < startAtMs;
}

export function isAfterScheduleEnd(trigger: TimeWindow, nowMs: number): boolean {
	const endAtMs = parseDateTimeToMs(trigger.endAt);
	return endAtMs != null && nowMs > endAtMs;
}

export function getDueIntervalRunAtMs(params: {
	trigger: IntervalTrigger;
	nowMs: number;
	lastRunAt?: number;
	fallbackAnchorMs?: number;
}): number | undefined {
	const { trigger, nowMs, lastRunAt, fallbackAnchorMs } = params;
	if (isBeforeScheduleStart(trigger, nowMs) || isAfterScheduleEnd(trigger, nowMs)) {
		return undefined;
	}
	const intervalMs = trigger.everySec * 1000;
	const referenceMs = lastRunAt ?? parseDateTimeToMs(trigger.startAt) ?? fallbackAnchorMs;
	if (referenceMs != null && nowMs - referenceMs < intervalMs) {
		return undefined;
	}
	return referenceMs == null ? nowMs : referenceMs + intervalMs;
}

export function getDueCronRunAtMs(params: {
	trigger: CronTrigger;
	nowMs: number;
	lastRunAt?: number;
	fallbackCurrentDateMs: number;
}): number | undefined {
	const { trigger, nowMs, lastRunAt, fallbackCurrentDateMs } = params;
	if (isBeforeScheduleStart(trigger, nowMs) || isAfterScheduleEnd(trigger, nowMs)) {
		return undefined;
	}
	const startAtMs = parseDateTimeToMs(trigger.startAt);
	const endAtMs = parseDateTimeToMs(trigger.endAt);
	const currentDateMs = lastRunAt ?? (startAtMs != null ? startAtMs - 1000 : fallbackCurrentDateMs);
	const expression = CronExpressionParser.parse(trigger.cron, {
		currentDate: new Date(currentDateMs),
		...(startAtMs != null ? { startDate: new Date(startAtMs) } : {}),
	});
	const nextRunAtMs = expression.next().getTime();
	if (endAtMs != null && nextRunAtMs > endAtMs) {
		return undefined;
	}
	if (nextRunAtMs > nowMs) {
		return undefined;
	}
	return nextRunAtMs;
}

export function getDueOnceRunAtMs(trigger: OnceTrigger, nowMs: number, deliveryCount: number): number | undefined {
	const runAtMs = Date.parse(trigger.runAt);
	if (!Number.isFinite(runAtMs) || nowMs < runAtMs || deliveryCount > 0) {
		return undefined;
	}
	return runAtMs;
}
