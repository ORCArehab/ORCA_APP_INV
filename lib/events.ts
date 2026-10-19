import { z } from "zod";

/** Wire format sent by components/analytics/tracker.ts. Unknown keys are rejected. */

export const MAX_BODY_BYTES = 8 * 1024;
export const MAX_EVENTS_PER_REQUEST = 20;

const Dim = z.object({ w: z.number().int().min(0).max(20000), h: z.number().int().min(0).max(20000) }).strict();

const Base = {
  eventId: z.uuid(),
  path: z.string().min(1).max(2048).startsWith("/"),
  ts: z.number().int().positive(),
};

export const EventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pageview"), ...Base }).strict(),
  z
    .object({
      type: z.literal("click"),
      ...Base,
      name: z.string().regex(/^[a-z0-9][a-z0-9_.:-]{0,63}$/, "event names are lowercase identifiers"),
      label: z.string().max(80).regex(/^[\w .:/#-]*$/).optional(),
    })
    .strict(),
]);

export const PayloadSchema = z
  .object({
    v: z.literal(1),
    sessionId: z.uuid(),
    referrer: z.string().max(2048).nullable(),
    env: z
      .object({
        languages: z.array(z.string().max(35).regex(/^[A-Za-z0-9-]+$/)).max(10),
        timeZone: z.string().max(64).regex(/^[A-Za-z0-9_+\-/]+$/).nullable(),
        screen: Dim.nullable(),
        viewport: Dim.nullable(),
        maxTouchPoints: z.number().int().min(0).max(256).nullable(),
        webdriver: z.boolean().nullable(),
      })
      .strict(),
    events: z.array(EventSchema).min(1).max(MAX_EVENTS_PER_REQUEST),
  })
  .strict();

export type Payload = z.infer<typeof PayloadSchema>;
export type TrackedEvent = z.infer<typeof EventSchema>;

export type ValidationResult = { ok: true; payload: Payload } | { ok: false; status: number; error: string };

export function validatePayload(raw: unknown): ValidationResult {
  const r = PayloadSchema.safeParse(raw);
  if (r.success) {
    const ids = new Set(r.data.events.map((e) => e.eventId));
    if (ids.size !== r.data.events.length) return { ok: false, status: 400, error: "duplicate eventId in batch" };
    return { ok: true, payload: r.data };
  }
  const issue = r.error.issues[0];
  return { ok: false, status: 400, error: `${issue.path.join(".") || "body"}: ${issue.message}` };
}

/** Reads at most `limit` bytes; returns null if the body is larger. */
export async function readLimitedBody(req: Request, limit = MAX_BODY_BYTES): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
