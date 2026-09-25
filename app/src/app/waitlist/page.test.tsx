import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import WaitlistPage from "./page";
import { POST } from "../api/waitlist/route";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("waitlist page", () => {
  it("states the offer, the three phases and the honest limit", () => {
    render(<WaitlistPage />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Token launches with a");
    expect(screen.getByText(/Presale\./)).toBeTruthy();
    expect(screen.getByText(/Market opens\./)).toBeTruthy();
    expect(screen.getByText(/Trading\./)).toBeTruthy();
    // The fee model: half the raise is the floor, 40% the pool, 5% each to the platform and the creator.
    expect(screen.getByText(/Half the raise becomes the floor/).textContent).toMatch(/40% becomes liquidity/);
    expect(screen.getByText(/Half the raise becomes the floor/).textContent).toMatch(/5% each/);
    expect(screen.getByText(/The floor creeps up/).textContent).toMatch(/part of every trading fee/);
    expect(screen.getByText(/protects from zero, not from loss/i)).toBeTruthy();
    expect(screen.getByText(/Not available to US persons/i)).toBeTruthy();
  });

  it("rejects a malformed address before it reaches the server", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<WaitlistPage />);

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "not-an-address" } });
    fireEvent.click(screen.getByRole("button", { name: /join the waitlist/i }));

    await screen.findByText(/looks incomplete/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("confirms the sign-up when the server accepts it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    render(<WaitlistPage />);

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "Someone@Example.com " } });
    fireEvent.click(screen.getByRole("button", { name: /join the waitlist/i }));

    await screen.findByText(/You are on the list/i);
    const [, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(String(init.body))).toEqual({ email: "someone@example.com" });
  });

  it("shows the server's own message when it refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Sign-ups are not open yet." }) }),
    );
    render(<WaitlistPage />);

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: /join the waitlist/i }));

    await screen.findByText(/Sign-ups are not open yet/i);
  });
});

describe("waitlist route", () => {
  const post = (body: unknown) =>
    POST(new Request("http://localhost/api/waitlist", { method: "POST", body: JSON.stringify(body) }));

  it("refuses a malformed address", async () => {
    const response = await post({ email: "nope" });
    expect(response.status).toBe(400);
  });

  it("answers 501 while no collector is configured, rather than dropping the address", async () => {
    vi.stubEnv("WAITLIST_WEBHOOK_URL", "");
    const response = await post({ email: "a@b.co" });
    expect(response.status).toBe(501);
    expect((await response.json()).error).toMatch(/not open/i);
  });

  it("forwards the address to the configured collector", async () => {
    vi.stubEnv("WAITLIST_WEBHOOK_URL", "https://hook.example/collect");
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    const response = await post({ email: " Someone@Example.com " });
    expect(response.status).toBe(200);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://hook.example/collect");
    expect(JSON.parse(String(init.body)).email).toBe("someone@example.com");
  });

  it("reports a failure of the collector as a failure", async () => {
    vi.stubEnv("WAITLIST_WEBHOOK_URL", "https://hook.example/collect");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const response = await post({ email: "a@b.co" });
    expect(response.status).toBe(502);
  });
});
