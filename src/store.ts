/**
 * Where the pipeline writes. The in-memory store is for tests and the demo;
 * schema/001_ops.sql is the same shape in Postgres, with row level security.
 */
import type { Capture, Item, Meeting, ReceiptFacts } from "./types.ts";

export interface Store {
  captureByMessageId(messageId: string): Capture | undefined;
  addCapture(c: Capture): void;
  addItem(i: Item): void;
  addMeeting(m: Meeting): void;
  addReceipt(r: ReceiptFacts): void;
}

export class MemoryStore implements Store {
  readonly captures: Capture[] = [];
  readonly items: Item[] = [];
  readonly meetings: Meeting[] = [];
  readonly receipts: ReceiptFacts[] = [];

  captureByMessageId(messageId: string) {
    return this.captures.find((c) => c.messageId === messageId);
  }
  addCapture(c: Capture) {
    this.captures.push(c);
  }
  addItem(i: Item) {
    this.items.push(i);
  }
  addMeeting(m: Meeting) {
    this.meetings.push(m);
  }
  addReceipt(r: ReceiptFacts) {
    this.receipts.push(r);
  }
}
