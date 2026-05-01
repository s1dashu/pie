/// <reference types="vite/client" />

import type { PieDesktopApi } from "../../shared/types";

declare global {
	interface Window {
		pie: PieDesktopApi;
	}
}
