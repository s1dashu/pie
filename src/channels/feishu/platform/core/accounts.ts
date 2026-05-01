/**
 * Adapted from larksuite/openclaw-lark.
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import type {
	ConfiguredLarkAccount,
	LarkAccountConfig,
	LarkConfig,
	LarkResolvedAccountConfig,
	LarkAccount,
	LarkBrand,
} from "./types.js";

export const DEFAULT_ACCOUNT_ID = "default";

function normalizeAccountId(id: string | undefined | null): string | undefined {
	return id?.trim().toLowerCase() || undefined;
}

function baseConfig(config: LarkConfig): Omit<LarkConfig, "accounts"> {
	const { accounts: _ignored, ...rest } = config;
	return rest;
}

function toBrand(config: LarkAccountConfig | undefined): LarkBrand {
	return config?.brand ?? config?.domain ?? "feishu";
}

function mergeAccountConfig(
	base: Omit<LarkConfig, "accounts">,
	override: LarkAccountConfig | undefined,
): LarkResolvedAccountConfig {
	const merged = { ...base, ...override };
	return {
		...merged,
		brand: toBrand(merged),
	};
}

export function getLarkAccountIds(config: LarkConfig): string[] {
	const accountIds = Object.keys(config.accounts ?? {});
	if (accountIds.length === 0) {
		return [DEFAULT_ACCOUNT_ID];
	}

	const normalizedDefault = normalizeAccountId(config.defaultAccountId);
	if (normalizedDefault && accountIds.includes(normalizedDefault)) {
		return [normalizedDefault, ...accountIds.filter((id) => id !== normalizedDefault)];
	}

	if (!accountIds.includes(DEFAULT_ACCOUNT_ID) && config.appId && config.appSecret) {
		return [DEFAULT_ACCOUNT_ID, ...accountIds];
	}

	return accountIds;
}

export function getDefaultLarkAccountId(config: LarkConfig): string {
	return getLarkAccountIds(config)[0] ?? DEFAULT_ACCOUNT_ID;
}

export function getLarkAccount(config: LarkConfig, accountId?: string | null): LarkAccount {
	const requestedId = normalizeAccountId(accountId) ?? getDefaultLarkAccountId(config);
	const base = baseConfig(config);
	const override = requestedId === DEFAULT_ACCOUNT_ID ? undefined : config.accounts?.[requestedId];
	const merged = mergeAccountConfig(base, override);

	const appId = merged.appId;
	const appSecret = merged.appSecret;
	const configured = Boolean(appId && appSecret);
	const enabled = Boolean(merged.enabled ?? configured);

	if (configured) {
		const account: ConfiguredLarkAccount = {
			accountId: requestedId,
			enabled,
			configured: true,
			name: merged.name,
			appId: appId!,
			appSecret: appSecret!,
			encryptKey: merged.encryptKey,
			verificationToken: merged.verificationToken,
			brand: merged.brand,
			config: merged,
		};
		return account;
	}

	return {
		accountId: requestedId,
		enabled,
		configured: false,
		name: merged.name,
		appId,
		appSecret,
		encryptKey: merged.encryptKey,
		verificationToken: merged.verificationToken,
		brand: merged.brand,
		config: merged,
	};
}

export function getEnabledLarkAccounts(config: LarkConfig): LarkAccount[] {
	return getLarkAccountIds(config)
		.map((accountId) => getLarkAccount(config, accountId))
		.filter((account) => account.enabled && account.configured);
}

export function createAccountScopedConfig(config: LarkConfig, accountId?: string | null): LarkConfig {
	const account = getLarkAccount(config, accountId);
	return {
		...config,
		...account.config,
		accounts: config.accounts,
		defaultAccountId: config.defaultAccountId,
	};
}
