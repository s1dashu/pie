/** Mount modal portals inside #root so backdrop is clipped to the same squircle as the app shell. */
export function getDialogPortalContainer(): HTMLElement | undefined {
	if (typeof document === "undefined") {
		return undefined
	}
	return document.getElementById("root") ?? undefined
}
