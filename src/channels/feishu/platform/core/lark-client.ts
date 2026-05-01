/**
 * Adapted from larksuite/openclaw-lark.
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as Lark from "@larksuiteoapi/node-sdk";
import { getLarkAccount } from "./accounts.js";
import { larkLogger } from "./logger.js";
import type { LarkConfig, LarkProbeResult, LarkAccount, LarkBrand, LarkClientCredentials } from "./types.js";
import { getUserAgent } from "./version.js";

const log = larkLogger("core/lark-client");
const GLOBAL_LARK_USER_AGENT_KEY = "LARK_USER_AGENT";
const BRAND_TO_DOMAIN: Record<string, Lark.Domain> = {
	feishu: Lark.Domain.Feishu,
	lark: Lark.Domain.Lark,
};
const cache = new Map<string, LarkClient>();

function installGlobalUserAgent(): void {
	(globalThis as Record<string, unknown>)[GLOBAL_LARK_USER_AGENT_KEY] = getUserAgent();
	Lark.defaultHttpInstance.interceptors.request.handlers = [];
	Lark.defaultHttpInstance.interceptors.request.use(
		(request) => {
			if (request.headers) {
				request.headers["User-Agent"] = getUserAgent();
			}
			return request;
		},
		undefined,
		{ synchronous: true },
	);
}

function resolveBrand(brand: LarkBrand | undefined): Lark.Domain | string {
	return BRAND_TO_DOMAIN[brand ?? "feishu"] ?? brand!.replace(/\/+$/, "");
}

function formatLarkApiError(error: unknown): string {
	const maybeAxios = error as {
		response?: {
			status?: number;
			data?: unknown;
		};
	};
	const responseData = maybeAxios.response?.data;
	const responseRecord =
		responseData && typeof responseData === "object" ? (responseData as Record<string, unknown>) : undefined;
	const responseCode = responseRecord?.code ?? responseRecord?.Code;
	const responseMsg = responseRecord?.msg ?? responseRecord?.message ?? responseRecord?.Msg;
	if (responseCode != null || responseMsg != null) {
		return `Lark API error${responseCode != null ? ` code=${String(responseCode)}` : ""}${responseMsg != null ? ` msg=${String(responseMsg)}` : ""}`;
	}
	return error instanceof Error ? error.message : String(error);
}

installGlobalUserAgent();

export class LarkClient {
	readonly account: LarkAccount;

	private sdkClient: Lark.Client | null = null;
	private wsClient: Lark.WSClient | null = null;
	private botOpenIdValue: string | undefined;
	private botNameValue: string | undefined;
	private lastProbeResult: LarkProbeResult | null = null;
	private lastProbeAt = 0;

	private constructor(account: LarkAccount) {
		this.account = account;
	}

	get accountId(): string {
		return this.account.accountId;
	}

	get sdk(): Lark.Client {
		if (!this.sdkClient) {
			const { appId, appSecret } = this.requireCredentials();
			this.sdkClient = new Lark.Client({
				appId,
				appSecret,
				appType: Lark.AppType.SelfBuild,
				domain: resolveBrand(this.account.brand),
			});
		}
		return this.sdkClient;
	}

	get botOpenId(): string | undefined {
		return this.botOpenIdValue;
	}

	get botName(): string | undefined {
		return this.botNameValue;
	}

	get wsConnected(): boolean {
		return this.wsClient !== null;
	}

	static fromConfig(config: LarkConfig, accountId?: string): LarkClient {
		return LarkClient.fromAccount(getLarkAccount(config, accountId));
	}

	static fromAccount(account: LarkAccount): LarkClient {
		const existing = cache.get(account.accountId);
		if (existing && existing.account.appId === account.appId && existing.account.appSecret === account.appSecret) {
			return existing;
		}
		if (existing) {
			log.info("credentials changed, disposing stale instance", { accountId: account.accountId });
			existing.dispose();
		}
		const instance = new LarkClient(account);
		cache.set(account.accountId, instance);
		return instance;
	}

	static fromCredentials(credentials: LarkClientCredentials): LarkClient {
		const account: LarkAccount =
			credentials.appId && credentials.appSecret
				? {
						accountId: credentials.accountId ?? "default",
						enabled: true,
						configured: true,
						appId: credentials.appId,
						appSecret: credentials.appSecret,
						brand: credentials.brand ?? "feishu",
						config: {
							appId: credentials.appId,
							appSecret: credentials.appSecret,
							brand: credentials.brand ?? "feishu",
						},
					}
				: {
						accountId: credentials.accountId ?? "default",
						enabled: false,
						configured: false,
						appId: credentials.appId,
						appSecret: credentials.appSecret,
						brand: credentials.brand ?? "feishu",
						config: {
							appId: credentials.appId,
							appSecret: credentials.appSecret,
							brand: credentials.brand ?? "feishu",
						},
					};
		return new LarkClient(account);
	}

	static get(accountId: string): LarkClient | null {
		return cache.get(accountId) ?? null;
	}

	static clearCache(accountId?: string): void {
		if (accountId) {
			cache.get(accountId)?.dispose();
			cache.delete(accountId);
			return;
		}

		for (const instance of cache.values()) {
			instance.dispose();
		}
		cache.clear();
	}

	async probe(opts?: { maxAgeMs?: number }): Promise<LarkProbeResult> {
		const maxAgeMs = opts?.maxAgeMs ?? 0;
		if (maxAgeMs > 0 && this.lastProbeResult && Date.now() - this.lastProbeAt < maxAgeMs) {
			return this.lastProbeResult;
		}

		if (!this.account.appId || !this.account.appSecret) {
			return { ok: false, error: "missing credentials (appId, appSecret)" };
		}

		try {
			const token = await (this.sdk as any).tokenManager?.getTenantAccessToken?.();
			if (!token) {
				return {
					ok: false,
					error:
						"Failed to obtain tenant access token. Check Feishu App ID, App Secret, region (Feishu vs Lark), and whether the newly created app has finished activation.",
					appId: this.account.appId,
				};
			}
			const response = await (this.sdk as any).request({
				method: "GET",
				url: "/open-apis/bot/v3/info",
				data: {},
				headers: {
					Authorization: `Bearer ${token}`,
				},
			});

			if (response?.code && response.code !== 0) {
				const result = {
					ok: false,
					error: response.msg ?? `Lark API error (code: ${response.code})`,
					appId: this.account.appId,
				} satisfies LarkProbeResult;
				this.lastProbeResult = result;
				this.lastProbeAt = Date.now();
				return result;
			}

			const bot = response?.bot ?? response?.data?.bot;
			this.botOpenIdValue = bot?.open_id;
			this.botNameValue = bot?.name ?? bot?.bot_name;
			const result = {
				ok: true,
				appId: this.account.appId,
				botOpenId: this.botOpenIdValue,
				botName: this.botNameValue,
			} satisfies LarkProbeResult;
			this.lastProbeResult = result;
			this.lastProbeAt = Date.now();
			return result;
		} catch (error) {
			const result = {
				ok: false,
				error: formatLarkApiError(error),
				appId: this.account.appId,
			} satisfies LarkProbeResult;
			this.lastProbeResult = result;
			this.lastProbeAt = Date.now();
			return result;
		}
	}

	dispose(): void {
		try {
			this.disconnect();
			this.sdkClient = null;
		} catch {
			// Ignore disposal errors.
		}
	}

	async startWS(opts: {
		handlers: Record<string, (data: unknown) => Promise<void> | void>;
		abortSignal?: AbortSignal;
		autoProbe?: boolean;
		/** Defaults to `warn` to keep startup quiet. */
		wsLoggerLevel?: Lark.LoggerLevel;
	}): Promise<void> {
		const { handlers, abortSignal, autoProbe = true, wsLoggerLevel = Lark.LoggerLevel.warn } = opts;

		if (autoProbe) {
			await this.probe();
		}

		const dispatcher = new Lark.EventDispatcher({
			encryptKey: this.account.encryptKey ?? "",
			verificationToken: this.account.verificationToken ?? "",
		});
		dispatcher.register(handlers as never);

		const { appId, appSecret } = this.requireCredentials();
		if (this.wsClient) {
			log.warn("closing previous WS client before reconnect", { accountId: this.accountId });
			try {
				this.wsClient.close({ force: true });
			} catch {
				// Ignore close errors.
			}
			this.wsClient = null;
		}

		this.wsClient = new Lark.WSClient({
			appId,
			appSecret,
			domain: resolveBrand(this.account.brand),
			// Keep SDK startup noise low unless caller raises level for troubleshooting.
			loggerLevel: wsLoggerLevel,
		});

		const wsClientAny = this.wsClient as any;
		const originalHandleEventData = wsClientAny.handleEventData.bind(wsClientAny);
		wsClientAny.handleEventData = (data: any) => {
			const messageType = data.headers?.find?.((header: any) => header.key === "type")?.value;
			if (messageType === "card") {
				const patchedData = {
					...data,
					headers: data.headers.map((header: any) =>
						header.key === "type" ? { ...header, value: "event" } : header,
					),
				};
				return originalHandleEventData(patchedData);
			}
			return originalHandleEventData(data);
		};

		await this.waitForAbort(dispatcher, abortSignal);
	}

	disconnect(): void {
		if (this.wsClient) {
			try {
				this.wsClient.close({ force: true });
			} catch {
				// Ignore close errors.
			}
			this.wsClient = null;
		}
	}

	private requireCredentials(): { appId: string; appSecret: string } {
		if (!this.account.appId || !this.account.appSecret) {
			throw new Error(`Lark account "${this.accountId}" is missing appId/appSecret`);
		}

		return {
			appId: this.account.appId,
			appSecret: this.account.appSecret,
		};
	}

	private waitForAbort(dispatcher: Lark.EventDispatcher, signal?: AbortSignal): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (signal?.aborted) {
				this.disconnect();
				resolve();
				return;
			}

			signal?.addEventListener(
				"abort",
				() => {
					try {
						this.disconnect();
					} finally {
						resolve();
					}
				},
				{ once: true },
			);

			try {
				void this.wsClient!.start({ eventDispatcher: dispatcher });
			} catch (error) {
				this.disconnect();
				reject(error);
			}
		});
	}
}
