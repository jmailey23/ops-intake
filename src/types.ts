export type Role = "owner" | "office" | "pm" | "crew" | "sub";

export interface Person {
  id: string;
  name: string;
  /** Every address this person writes from. A note from a personal account is still their note. */
  emails: string[];
  role: Role;
}

export interface Job {
  id: string;
  name: string;
  /** The words people actually use for the job: a street, a client's surname, a room. */
  aliases: string[];
}

export interface Attachment {
  name: string;
  mime: string;
  /** Base64, no data: prefix. */
  data?: string;
}

export interface Mail {
  messageId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  /** ISO 8601. */
  date: string;
  attachments?: Attachment[];
}

/** What was received, exactly as received. Never edited after insert. */
export interface Capture {
  id: string;
  messageId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  receivedAt: string;
  /** Sent by someone on the team, to someone on the team, and not machine mail. */
  internal: boolean;
  writerId: string | null;
  filing: Filing;
}

export type Filing =
  | { status: "filed"; jobId: string }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "general" };

export type ItemKind = "task" | "material" | "issue";

/** An interpretation of a capture. Can be edited, reassigned, closed. */
export interface Item {
  id: string;
  captureId: string;
  title: string;
  detail: string | null;
  kind: ItemKind;
  urgent: boolean;
  /** Money, scope and unhappy clients go to the owner. Everything else the team can take. */
  needsOwnerDecision: boolean;
  ownerId: string | null;
  filing: Filing;
}

export interface Meeting {
  captureId: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  confidence: number;
}

/** Facts read off a photo. A person approves them before anything touches the books. */
export interface ReceiptFacts {
  captureId: string;
  attachment: string;
  kind: "receipt" | "check" | "invoice" | "other";
  amountCents: number | null;
  payee: string | null;
  date: string | null;
  reference: string | null;
  status: "needs_approval";
}
