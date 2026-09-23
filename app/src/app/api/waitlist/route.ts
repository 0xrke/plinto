/**
 * Waitlist sign-ups.
 *
 * The app has no database, so the address is forwarded to whatever collects it: set
 * `WAITLIST_WEBHOOK_URL` to a form endpoint (Formspree, Tally, a Zapier or n8n hook, your own service).
 * Without it the route answers 501 and the page says sign-ups are not open — better than accepting an
 * address and dropping it.
 */
export const dynamic = "force-dynamic";

const VALID = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(request: Request) {
  let email: unknown;
  try {
    ({ email } = (await request.json()) as { email?: unknown });
  } catch {
    return Response.json({ error: "Send JSON with an email field." }, { status: 400 });
  }

  if (typeof email !== "string" || email.length > 254 || !VALID.test(email.trim().toLowerCase())) {
    return Response.json({ error: "That address looks incomplete — check it and try again." }, { status: 400 });
  }
  const address = email.trim().toLowerCase();

  const webhook = process.env.WAITLIST_WEBHOOK_URL;
  if (!webhook) {
    return Response.json(
      { error: "Sign-ups are not open yet. Come back shortly." },
      { status: 501 },
    );
  }

  try {
    const forwarded = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email: address, source: "plinto-waitlist", joinedAt: new Date().toISOString() }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!forwarded.ok) {
      return Response.json({ error: "Could not save that — try again in a moment." }, { status: 502 });
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Could not save that — try again in a moment." }, { status: 502 });
  }
}
