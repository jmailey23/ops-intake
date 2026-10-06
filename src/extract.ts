/**
 * The model half of the pipeline.
 *
 * Claude is used where reading takes judgment and a wrong answer is cheap to
 * catch: is this note also a meeting, and what does this photo of a receipt
 * say. Both come back as structured data validated against a schema, and
 * neither is trusted on its own:
 *
 *   - a meeting is only created at confidence 0.8 or above, and the task the
 *     note produced stays either way
 *   - receipt facts are stored as "needs_approval"; nothing here writes money
 *
 * The pipeline depends on the Extractor interface, not on Claude, so it runs
 * and tests without a key (see NoExtractor).
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export interface MeetingGuess {
  isMeeting: boolean;
  confidence: number;
  title: string | null;
  start: string | null;
  end: string | null;
  location: string | null;
}

export interface ReceiptGuess {
  kind: "receipt" | "check" | "invoice" | "other";
  amount: number | null;
  payee: string | null;
  date: string | null;
  reference: string | null;
}

export interface Extractor {
  readMeeting(subject: string, body: string, receivedAt: Date): Promise<MeetingGuess | null>;
  readPicture(mime: string, base64: string): Promise<ReceiptGuess | null>;
}

/** For running without a model. The deterministic pipeline is complete without it. */
export const NoExtractor: Extractor = {
  readMeeting: async () => null,
  readPicture: async () => null,
};

const MeetingSchema = z.object({
  isMeeting: z.boolean().describe("True only if the note arranges a specific meeting, visit or call at a specific time."),
  confidence: z.number().min(0).max(1),
  title: z.string().nullable().describe("Short: who and what, no date."),
  start: z.string().nullable().describe("Local time, YYYY-MM-DDTHH:MM."),
  end: z.string().nullable(),
  location: z.string().nullable(),
});

const ReceiptSchema = z.object({
  kind: z.enum(["receipt", "check", "invoice", "other"]),
  amount: z.number().nullable().describe("Total in dollars, e.g. 1284.50. Null if not legible."),
  payee: z.string().nullable(),
  date: z.string().nullable().describe("YYYY-MM-DD"),
  reference: z.string().nullable().describe("Check number, invoice number or receipt number."),
});

export interface ClaudeExtractorOptions {
  client?: Anthropic;
  model?: string;
  /** IANA zone the business runs in, so "Thursday at 2" resolves to the right day. */
  timeZone?: string;
}

export class ClaudeExtractor implements Extractor {
  private client: Anthropic;
  private model: string;
  private timeZone: string;

  constructor(opts: ClaudeExtractorOptions = {}) {
    this.client = opts.client ?? new Anthropic();
    this.model = opts.model ?? process.env.OPS_INTAKE_MODEL ?? "claude-opus-5-5";
    this.timeZone = opts.timeZone ?? "America/Chicago";
  }

  async readMeeting(subject: string, body: string, receivedAt: Date): Promise<MeetingGuess | null> {
    const sent = receivedAt.toLocaleString("en-US", {
      timeZone: this.timeZone, weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
    return this.parse(MeetingSchema, [
      {
        type: "text",
        text:
          `A note from a construction company's team, sent ${sent} (${this.timeZone}).\n` +
          `Subject: ${subject}\n\n${body}\n\n` +
          "Does it arrange a meeting, site visit or call at a specific time? Resolve relative days " +
          "against the sent date. If the time is vague or absent, it is not a meeting.",
      },
    ]);
  }

  async readPicture(mime: string, base64: string): Promise<ReceiptGuess | null> {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(mime)) return null;
    return this.parse(ReceiptSchema, [
      { type: "image", source: { type: "base64", media_type: mime as "image/png", data: base64 } },
      {
        type: "text",
        text: "What is this, and what would a bookkeeper need from it? Leave a field null rather than guess.",
      },
    ]);
  }

  private async parse<T extends z.ZodType>(
    schema: T,
    content: Anthropic.Beta.BetaContentBlockParam[],
  ): Promise<z.infer<T> | null> {
    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 2048,
        output_config: { effort: "low", format: betaZodOutputFormat(schema) },
        // On a policy decline the API re-runs the request on a fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        messages: [{ role: "user", content }],
      });
      if (response.stop_reason === "refusal") return null;
      return (response.parsed_output as z.infer<T> | null) ?? null;
    } catch (error) {
      // Extraction is an extra. A failed read leaves the note as a plain task;
      // it never blocks ingest.
      if (error instanceof Anthropic.APIError) {
        console.warn(`extraction skipped: ${error.status} ${error.message}`);
        return null;
      }
      throw error;
    }
  }
}
