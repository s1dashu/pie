export interface AgentStartLimiterOptions {
	defaultLimit?: number;
	limits?: Record<string, number>;
	getWeight?: (harnessKind: string | undefined) => number;
	getBudget?: () => { maxConcurrent: number; maxWeight: number };
}

export class AgentStartLimiter {
	private readonly defaultLimit: number;
	private readonly limits: Record<string, number>;
	private readonly getWeight: (harnessKind: string | undefined) => number;
	private readonly getBudget: () => { maxConcurrent: number; maxWeight: number };
	private readonly active = new Map<string, number>();
	private activeWeight = 0;
	private readonly waiters: Array<{
		key: string;
		weight: number;
		resolve: () => void;
	}> = [];

	constructor(options: AgentStartLimiterOptions = {}) {
		this.defaultLimit = options.defaultLimit ?? Number.POSITIVE_INFINITY;
		this.limits = options.limits ?? {};
		this.getWeight = options.getWeight ?? (() => 1);
		this.getBudget = options.getBudget ?? (() => ({
			maxConcurrent: Number.POSITIVE_INFINITY,
			maxWeight: Number.POSITIVE_INFINITY,
		}));
	}

	async run<T>(harnessKind: string | undefined, task: () => Promise<T>): Promise<T> {
		const key = harnessKind?.trim() || "default";
		await this.acquire(key, this.getWeight(harnessKind));
		try {
			return await task();
		} finally {
			this.release(key, this.getWeight(harnessKind));
		}
	}

	private async acquire(key: string, weight: number): Promise<void> {
		if (this.canStart(key, weight)) {
			this.reserve(key, weight);
			return;
		}
		await new Promise<void>((resolve) => {
			this.waiters.push({ key, weight, resolve });
		});
	}

	private release(key: string, weight: number): void {
		const nextActive = Math.max(0, (this.active.get(key) ?? 1) - 1);
		if (nextActive) {
			this.active.set(key, nextActive);
		} else {
			this.active.delete(key);
		}
		this.activeWeight = Math.max(0, this.activeWeight - weight);
		this.drain();
	}

	private canStart(key: string, weight: number): boolean {
		const limit = this.limits[key] ?? this.defaultLimit;
		const budget = this.getBudget();
		const activeCount = [...this.active.values()].reduce((total, count) => total + count, 0);
		const canRunOverweightSolo = activeCount === 0 && this.activeWeight === 0 && weight > budget.maxWeight;
		return (
			(this.active.get(key) ?? 0) < limit &&
			activeCount < budget.maxConcurrent &&
			(this.activeWeight + weight <= budget.maxWeight || canRunOverweightSolo)
		);
	}

	private reserve(key: string, weight: number): void {
		this.active.set(key, (this.active.get(key) ?? 0) + 1);
		this.activeWeight += weight;
	}

	private drain(): void {
		for (let index = 0; index < this.waiters.length;) {
			const waiter = this.waiters[index]!;
			if (!this.canStart(waiter.key, waiter.weight)) {
				index += 1;
				continue;
			}
			this.waiters.splice(index, 1);
			this.reserve(waiter.key, waiter.weight);
			waiter.resolve();
		}
	}
}
