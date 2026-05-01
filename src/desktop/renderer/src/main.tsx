import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<QueryClientProvider client={queryClient}>
			<Theme
				accentColor="lime"
				grayColor="slate"
				radius="large"
				scaling="100%"
				hasBackground={false}
				className="h-full w-full bg-transparent"
			>
				<App />
			</Theme>
		</QueryClientProvider>
	</React.StrictMode>,
);
