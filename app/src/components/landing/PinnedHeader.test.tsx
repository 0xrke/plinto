import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { PinnedHeader } from "./PinnedHeader";

type Callback = (entries: Partial<IntersectionObserverEntry>[]) => void;

/** Captures the observer's callback and target, so a test can play scroll positions into it. */
function stubObserver() {
  const seen: { callback?: Callback; target?: Element; disconnected: boolean } = { disconnected: false };
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: Callback) {
        seen.callback = callback;
      }
      observe(target: Element) {
        seen.target = target;
      }
      unobserve() {}
      disconnect() {
        seen.disconnected = true;
      }
      takeRecords() {
        return [];
      }
    },
  );
  return seen;
}

function renderWithNav() {
  return render(
    <>
      <PinnedHeader watch="hero-nav">
        <a href="/app">Open app</a>
      </PinnedHeader>
      <nav id="hero-nav" />
    </>,
  );
}

const at = (top: number, isIntersecting: boolean) => [{ isIntersecting, boundingClientRect: { top } as DOMRect }];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("<PinnedHeader />", () => {
  it("starts hidden: inert and out of the accessibility tree", () => {
    stubObserver();
    const { container } = renderWithNav();
    const header = container.querySelector("header")!;
    expect(header.getAttribute("aria-hidden")).toBe("true");
    expect(header.hasAttribute("inert")).toBe(true);
    expect(header.hasAttribute("data-shown")).toBe(false);
  });

  it("reveals once the watched nav scrolls out above the viewport, and hides when it returns", () => {
    const io = stubObserver();
    const { container } = renderWithNav();
    const header = container.querySelector("header")!;
    expect(io.target?.id).toBe("hero-nav");

    act(() => io.callback!(at(-80, false)));
    expect(header.hasAttribute("data-shown")).toBe(true);
    expect(header.getAttribute("aria-hidden")).toBeNull();
    expect(header.hasAttribute("inert")).toBe(false);

    act(() => io.callback!(at(20, true)));
    expect(header.hasAttribute("data-shown")).toBe(false);
    expect(header.hasAttribute("inert")).toBe(true);
  });

  it("stays hidden while the nav is out of view below the viewport", () => {
    const io = stubObserver();
    const { container } = renderWithNav();
    act(() => io.callback!(at(2000, false)));
    expect(container.querySelector("header")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("stops observing on unmount", () => {
    const io = stubObserver();
    const { unmount } = renderWithNav();
    unmount();
    expect(io.disconnected).toBe(true);
  });
});
