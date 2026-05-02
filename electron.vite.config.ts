import { resolve } from "node:path";
import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const packageJson = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")) as {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
};
const externalPackages = new Set([
	"electron",
	...builtinModules,
	...builtinModules.map((name) => `node:${name}`),
	...Object.keys(packageJson.dependencies ?? {}),
	...Object.keys(packageJson.devDependencies ?? {}),
]);

function isExternalDependency(id: string): boolean {
	if (id.startsWith("node:") || externalPackages.has(id)) {
		return true;
	}
	for (const pkg of externalPackages) {
		if (id.startsWith(`${pkg}/`)) {
			return true;
		}
	}
	return false;
}

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
		build: {
			rollupOptions: {
				input: resolve(__dirname, "src/desktop/main/index.ts"),
				external: isExternalDependency,
				treeshake: false,
			},
		},
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		build: {
			rollupOptions: {
				external: ["electron"],
			},
			lib: {
				entry: resolve(__dirname, "src/desktop/preload/index.ts"),
				formats: ["cjs"],
			},
		},
	},
	renderer: {
		root: resolve(__dirname, "src/desktop/renderer"),
		plugins: [react(), tailwindcss()],
		server: {
			host: "127.0.0.1",
		},
		build: {
			rollupOptions: {
				input: resolve(__dirname, "src/desktop/renderer/index.html"),
			},
		},
		resolve: {
			alias: {
				"@": resolve(__dirname, "src/desktop/renderer/src"),
			},
			dedupe: ["react", "react-dom"],
		},
		optimizeDeps: {
			include: ["react", "react-dom", "@tanstack/react-query", "sonner", "next-themes", "qrcode.react"],
		},
	},
});
