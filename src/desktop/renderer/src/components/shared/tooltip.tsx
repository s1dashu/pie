"use client";

import { type FocusEvent, type MouseEvent, type ReactNode, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	AnimatePresence,
	motion,
	useMotionValue,
	useSpring,
	useTransform,
} from "motion/react";
import { cn } from "../../lib/utils";

interface TooltipPosition {
	left: number;
	top: number;
	side: "top" | "bottom";
}

export function AceternityTooltip({
	content,
	children,
	className,
	contentClassName,
	side = "top",
}: {
	content: ReactNode;
	children: ReactNode;
	className?: string;
	contentClassName?: string;
	side?: "top" | "bottom";
}): JSX.Element {
	const [isHovered, setIsHovered] = useState(false);
	const [position, setPosition] = useState<TooltipPosition | undefined>();
	const x = useMotionValue(0);
	const animationFrameRef = useRef<number | null>(null);
	const springConfig = { stiffness: 100, damping: 15 };
	const rotate = useSpring(useTransform(x, [-100, 100], [-45, 45]), springConfig);
	const translateX = useSpring(useTransform(x, [-100, 100], [-50, 50]), springConfig);
	const initialY = position?.side === "bottom" ? -20 : 20;

	const updatePosition = (target: HTMLElement, clientX?: number) => {
		const rect = target.getBoundingClientRect();
		const preferredSide = side;
		const canUseTop = rect.top > 84;
		const canUseBottom = window.innerHeight - rect.bottom > 84;
		const nextSide = preferredSide === "top" && !canUseTop && canUseBottom
			? "bottom"
			: preferredSide === "bottom" && !canUseBottom && canUseTop
				? "top"
				: preferredSide;
		const baseLeft = Math.min(Math.max(rect.left + rect.width / 2, 88), window.innerWidth - 88);
		const baseTop = nextSide === "bottom" ? rect.bottom + 12 : rect.top - 12;
		setPosition({ left: baseLeft, top: baseTop, side: nextSide });
		if (clientX !== undefined) {
			x.set(clientX - rect.left - rect.width / 2);
		}
	};

	const handleMouseEnter = (event: MouseEvent<HTMLElement>) => {
		updatePosition(event.currentTarget, event.clientX);
		setIsHovered(true);
	};

	const handleMouseMove = (event: MouseEvent<HTMLElement>) => {
		if (animationFrameRef.current) {
			cancelAnimationFrame(animationFrameRef.current);
		}
		animationFrameRef.current = requestAnimationFrame(() => {
			updatePosition(event.currentTarget, event.clientX);
		});
	};

	const handleFocus = (event: FocusEvent<HTMLElement>) => {
		updatePosition(event.currentTarget);
		setIsHovered(true);
	};

	return (
		<span
			className={cn("relative inline-flex", className)}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={() => setIsHovered(false)}
			onMouseMove={handleMouseMove}
			onFocus={handleFocus}
			onBlur={() => setIsHovered(false)}
		>
			{typeof document !== "undefined" ? createPortal(
				<AnimatePresence>
					{isHovered && position && (
						<motion.span
							initial={{ opacity: 0, y: initialY, scale: 0.6 }}
							animate={{
								opacity: 1,
								y: 0,
								scale: 1,
								transition: {
									type: "spring",
									stiffness: 260,
									damping: 10,
								},
							}}
							exit={{ opacity: 0, y: initialY, scale: 0.6 }}
							style={{
								left: position.left,
								top: position.top,
								translateX,
								rotate,
								whiteSpace: "nowrap",
								transformOrigin: position.side === "bottom" ? "top center" : "bottom center",
							}}
							className={cn(
								"pointer-events-none fixed z-[9999] flex -translate-x-1/2 flex-col items-center justify-center rounded-md bg-black px-4 py-2 text-xs text-white shadow-xl",
								position.side === "top" ? "-translate-y-full" : "",
								contentClassName,
							)}
						>
							<span className="absolute inset-x-10 -bottom-px z-30 h-px w-[20%] bg-gradient-to-r from-transparent via-[var(--lime-9)] to-transparent" />
							<span className="absolute -bottom-px left-10 z-30 h-px w-[40%] bg-gradient-to-r from-transparent via-[var(--lime-7)] to-transparent" />
							<span className="relative z-30 whitespace-pre text-center text-base font-bold leading-tight text-white tabular-nums">
								{content}
							</span>
						</motion.span>
					)}
				</AnimatePresence>,
				document.body,
			) : null}
			{children}
		</span>
	);
}
