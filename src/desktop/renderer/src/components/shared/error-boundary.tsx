import React from "react";
import { Button } from "../ui/button";

interface ErrorBoundaryState {
	error?: Error;
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
	state: ErrorBoundaryState = {};

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: Error, info: React.ErrorInfo): void {
		console.error("[renderer] uncaught component error:", error, info);
	}

	render(): React.ReactNode {
		if (!this.state.error) {
			return this.props.children;
		}

		return (
			<div className="app-continuous-corner flex h-full w-full items-center justify-center bg-[var(--slate-3)] p-6 text-foreground">
				<div className="no-drag max-w-md rounded-4xl bg-white p-6 text-center shadow-[0_8px_32px_rgba(0,0,0,0.08)] ring-1 ring-foreground/5">
					<h1 className="text-base font-medium">界面出现错误</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						{this.state.error.message || "请刷新窗口后重试"}
					</p>
					<Button className="mt-5 h-9 rounded-4xl px-5" onClick={() => this.setState({ error: undefined })}>
						返回应用
					</Button>
				</div>
			</div>
		);
	}
}
