type AsyncWork = () => Promise<void>;

export class ConversationQueue {
	private queue: AsyncWork[] = [];
	private processing = false;

	enqueue(work: AsyncWork): void {
		this.queue.push(work);
		void this.processNext();
	}

	size(): number {
		return this.queue.length;
	}

	private async processNext(): Promise<void> {
		if (this.processing || this.queue.length === 0) {
			return;
		}
		this.processing = true;
		const work = this.queue.shift();
		try {
			if (work) {
				await work();
			}
		} finally {
			this.processing = false;
			if (this.queue.length > 0) {
				void this.processNext();
			}
		}
	}
}
