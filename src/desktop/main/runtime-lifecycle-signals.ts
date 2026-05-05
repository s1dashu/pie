import type {
	RuntimeEnvironmentLifecycleState,
	RuntimeEnvironmentLifecycleSnapshot,
} from "../../runtime/environment.js";

const AGENT_READY_LOG_MARKERS = [
	"Feishu channel ready",
	"Feishu bot ready",
	"Wechat channel ready",
	"Slack channel ready",
	"Discord channel ready",
	"Telegram channel ready",
	"Pi Feishu bot ready",
	"Pi Wechat channel ready",
	"Pi Slack channel ready",
	"Pi Discord channel ready",
	"Pi Telegram channel ready",
	"OpenClaw gateway ready",
	"[gateway] ready",
	"[gateway] http server listening",
	"OpenClaw gateway already reachable",
];

const WECHAT_SESSION_EXPIRED_MARKER = "微信会话已失效（errcode -14）";
const WECHAT_SESSION_STILL_EXPIRED_MARKER = "微信会话仍然失效（errcode -14）";
const WECHAT_SESSION_RECOVERED_MARKER = "微信会话已恢复";

export interface RuntimeLifecycleLogTransition {
	state: RuntimeEnvironmentLifecycleState;
	reason: string;
}

export function isRuntimeReadyLog(text: string): boolean {
	return AGENT_READY_LOG_MARKERS.some((marker) => text.includes(marker));
}

export function getRuntimeLifecycleLogTransition(
	snapshot: RuntimeEnvironmentLifecycleSnapshot,
	text: string,
): RuntimeLifecycleLogTransition | undefined {
	if (text.includes(WECHAT_SESSION_EXPIRED_MARKER) || text.includes(WECHAT_SESSION_STILL_EXPIRED_MARKER)) {
		return { state: "degraded", reason: "wechat-session-expired" };
	}
	if (text.includes(WECHAT_SESSION_RECOVERED_MARKER) && snapshot.state === "degraded") {
		return { state: "running", reason: "wechat-session-recovered" };
	}
	return undefined;
}
