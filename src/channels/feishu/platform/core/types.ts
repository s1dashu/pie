/**
 * Adapted from larksuite/openclaw-lark.
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

export type LarkBrand = "feishu" | "lark" | (string & {});

export type LarkIdType = "open_id" | "user_id" | "union_id" | "chat_id";

export interface LarkAccountConfig {
	enabled?: boolean;
	name?: string;
	appId?: string;
	appSecret?: string;
	brand?: LarkBrand;
	domain?: LarkBrand;
	encryptKey?: string;
	verificationToken?: string;
}

export interface LarkConfig extends LarkAccountConfig {
	defaultAccountId?: string;
	accounts?: Record<string, LarkAccountConfig>;
}

export interface LarkResolvedAccountConfig extends LarkAccountConfig {
	brand: LarkBrand;
}

interface LarkAccountBase {
	accountId: string;
	enabled: boolean;
	name?: string;
	encryptKey?: string;
	verificationToken?: string;
	brand: LarkBrand;
	config: LarkResolvedAccountConfig;
}

export type ConfiguredLarkAccount = LarkAccountBase & {
	configured: true;
	appId: string;
	appSecret: string;
};

export type UnconfiguredLarkAccount = LarkAccountBase & {
	configured: false;
	appId?: string;
	appSecret?: string;
};

export type LarkAccount = ConfiguredLarkAccount | UnconfiguredLarkAccount;

export interface LarkClientCredentials {
	accountId?: string;
	appId?: string;
	appSecret?: string;
	brand?: LarkBrand;
}

export interface LarkProbeResult {
	ok: boolean;
	error?: string;
	appId?: string;
	botName?: string;
	botOpenId?: string;
	botAvatarUrl?: string;
}
