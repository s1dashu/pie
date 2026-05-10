export const OUSIA_ENV = {
	home: "OUSIA_HOME",
	workDir: "OUSIA_WORK_DIR",
	parentPid: "OUSIA_PARENT_PID",
	hostChannel: "OUSIA_HOST_CHANNEL",
	runGatewayPort: "OUSIA_RUN_GATEWAY_PORT",
	runGatewaySecret: "OUSIA_RUN_GATEWAY_SECRET",
	disableDailyDistillation: "OUSIA_DISABLE_DAILY_DISTILLATION",
} as const;

export const OUSIA_RUNTIME_SECRET_HEADER = "x-ousia-runtime-secret";
