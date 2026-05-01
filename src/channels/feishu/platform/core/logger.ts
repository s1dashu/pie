/**
 * Adapted from larksuite/openclaw-lark.
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

export interface LarkLogger {
	readonly subsystem: string;
	debug(message: string, meta?: Record<string, unknown>): void;
	info(message: string, meta?: Record<string, unknown>): void;
	warn(message: string, meta?: Record<string, unknown>): void;
	error(message: string, meta?: Record<string, unknown>): void;
	child(name: string): LarkLogger;
}

const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";
const RESET = "\x1b[0m";

function formatMessage(tag: string, message: string, meta?: Record<string, unknown>): unknown[] {
	if (!meta || Object.keys(meta).length === 0) {
		return [`${tag} ${message}`];
	}
	return [`${tag} ${message}`, meta];
}

function createLogger(subsystem: string): LarkLogger {
	const tag = `pi-feishu/${subsystem}`;
	return {
		subsystem,
		debug(message, meta) {
			console.debug(...formatMessage(`${GRAY}[${tag}]${RESET}`, message, meta));
		},
		info(message, meta) {
			console.log(...formatMessage(`${CYAN}[${tag}]${RESET}`, message, meta));
		},
		warn(message, meta) {
			console.warn(...formatMessage(`${YELLOW}[${tag}]${RESET}`, message, meta));
		},
		error(message, meta) {
			console.error(...formatMessage(`${RED}[${tag}]${RESET}`, message, meta));
		},
		child(name) {
			return createLogger(`${subsystem}/${name}`);
		},
	};
}

export function larkLogger(subsystem: string): LarkLogger {
	return createLogger(subsystem);
}
