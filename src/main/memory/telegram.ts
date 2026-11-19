import type { TelegramReader } from '../hermes/telegram';
import type { FactStore } from './store';
import type { PersonalMemory } from './service';

/** Polls opt-in Telegram direct messages; the store owns the durable cursor. */
export class TelegramCapture {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;

  constructor(private store: FactStore, private memory: PersonalMemory, private reader: TelegramReader,
    private profiles: () => Promise<string[]>) {}

  start(): void {
    void this.sweep();
    this.timer = setInterval(() => { void this.sweep(); }, 15_000);
    this.timer.unref();
  }

  stop(): void { this.stopped = true; clearInterval(this.timer); }

  sweep(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.scan().catch((e) => {
      this.memory.telegram.error = e instanceof Error ? e.message : String(e);
    }).finally(() => { this.running = undefined; });
    return this.running;
  }

  private enabled(): boolean {
    const s = this.store.settings();
    return !this.stopped && s.enabled && s.telegramEnabled === true;
  }

  private async scan(): Promise<void> {
    if (!this.enabled()) return;
    const since = this.store.telegramSince();
    if (!since) throw new Error('Turn Telegram capture off and on again to initialize it.');
    for (const profileId of await this.profiles()) {
      if (!this.enabled() || this.store.telegramSince() !== since) return;
      const readGeneration = this.store.generation();
      const messages = await this.reader.telegramMessages(profileId, this.store.telegramCursor(profileId), since);
      for (const message of messages) {
        if (!this.enabled() || this.store.telegramSince() !== since) return;
        if (this.store.generation() !== readGeneration) {
          await this.store.put([], this.store.generation(), { profileId, id: messages.at(-1)!.id });
          return;
        }
        const generation = this.store.generation();
        const cursor = { profileId, id: message.id };
        const saved = message.text.trim() && message.text.length <= 12_000
          ? await this.memory.captureTelegram(message.text, { profileId, sessionId: message.sessionId }, message.id)
          : await this.store.put([], generation, cursor);
        if (!saved) {
          // A review cancels extraction; do not replay that old message after
          // deletion. A model/disk failure leaves the cursor intact for retry.
          if (this.enabled() && this.store.telegramSince() === since && this.store.generation() !== generation) {
            await this.store.put([], this.store.generation(), { profileId, id: messages.at(-1)!.id });
          } else if (this.enabled()) {
            throw new Error(this.memory.view().error ?? 'Telegram capture could not complete; it will retry.');
          }
          return;
        }
      }
    }
    this.memory.telegram.checkedAt = new Date().toISOString();
    this.memory.telegram.error = null;
  }
}
