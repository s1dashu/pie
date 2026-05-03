import qrcodeTerminal from "qrcode-terminal";
import { upsertAgentEnv } from "../../core/agent-home.js";
import {
	DEFAULT_WECHAT_BASE_URL,
	fetchLoginQr,
	pollLoginQrStatus,
} from "./platform/api.js";
import { normalizeWechatAccountId } from "./state.js";

export interface WechatLoginResult {
	accountId: string;
	baseUrl: string;
	token: string;
	userId?: string;
}

const QR_STATUS_TIMEOUT_MS = 35_000;
const LOGIN_TIMEOUT_MS = 480_000;
const MAX_QR_REFRESH_COUNT = 3;

export async function loginWechatWithQr(params: {
	homeDir: string;
	baseUrl?: string;
	botType: string;
	routeTag?: string;
	timeoutMs?: number;
}): Promise<WechatLoginResult> {
	const fixedBaseUrl = DEFAULT_WECHAT_BASE_URL;
	let qr = await fetchLoginQr({
		baseUrl: fixedBaseUrl,
		botType: params.botType,
		routeTag: params.routeTag,
	});
	let refreshCount = 1;
	let scannedPrinted = false;
	const deadline = Date.now() + (params.timeoutMs ?? LOGIN_TIMEOUT_MS);
	console.log("\n使用微信扫描以下二维码，以完成连接：\n");
	qrcodeTerminal.generate(qr.qrcode_img_content, { small: true });
	console.log(`如果二维码未能成功展示，请用浏览器打开以下链接扫码：\n${qr.qrcode_img_content}\n`);

	while (Date.now() < deadline) {
		const status = await pollLoginQrStatus({
			baseUrl: fixedBaseUrl,
			qrcode: qr.qrcode,
			timeoutMs: QR_STATUS_TIMEOUT_MS,
			routeTag: params.routeTag,
		});
		switch (status.status) {
			case "wait":
				process.stdout.write(".");
				break;
			case "scaned":
				if (!scannedPrinted) {
					process.stdout.write("\n已扫码，请在微信里继续确认...\n");
					scannedPrinted = true;
				}
				break;
			case "expired":
				refreshCount += 1;
				if (refreshCount > MAX_QR_REFRESH_COUNT) {
					throw new Error("微信登录二维码多次过期，请重新启动登录。");
				}
				process.stdout.write(`\n二维码已过期，正在刷新 (${refreshCount}/${MAX_QR_REFRESH_COUNT})...\n`);
				qr = await fetchLoginQr({
					baseUrl: fixedBaseUrl,
					botType: params.botType,
					routeTag: params.routeTag,
				});
				qrcodeTerminal.generate(qr.qrcode_img_content, { small: true });
				console.log(`如果二维码未能成功展示，请用浏览器打开以下链接扫码：\n${qr.qrcode_img_content}\n`);
				scannedPrinted = false;
				break;
			case "scaned_but_redirect":
				break;
			case "confirmed": {
				const token = status.bot_token?.trim();
				const rawAccountId = status.ilink_bot_id?.trim();
				if (!token || !rawAccountId) {
					throw new Error("微信登录已确认，但响应缺少 bot token 或 account id。");
				}
				const accountId = normalizeWechatAccountId(rawAccountId);
				const baseUrl = status.baseurl?.trim() || params.baseUrl?.trim() || DEFAULT_WECHAT_BASE_URL;
				upsertAgentEnv(
					{
						WECHAT_BOT_TOKEN: token,
						WECHAT_ACCOUNT_ID: accountId,
						WECHAT_BASE_URL: baseUrl,
						...(status.ilink_user_id?.trim() ? { WECHAT_USER_ID: status.ilink_user_id.trim() } : {}),
					},
					params.homeDir,
				);
				console.log("\n微信连接成功。");
				return {
					accountId,
					baseUrl,
					token,
					userId: status.ilink_user_id?.trim() || undefined,
				};
			}
		}
	}
	throw new Error("微信登录超时，请重新启动登录。");
}
