import { describe, expect, it } from "vitest"
import {
  INSTALL_DISMISS_DAYS,
  INSTALL_MIN_VISITS,
  bumpVisitCount,
  installDismissedUntil,
  parseVisitCount,
  shouldOfferInstall,
} from "../src/lib/install-prompt"

describe("install-prompt: visit counting", () => {
  it("parses invalid, empty and negative values as 0", () => {
    expect(parseVisitCount(null)).toBe(0)
    expect(parseVisitCount("")).toBe(0)
    expect(parseVisitCount("abc")).toBe(0)
    expect(parseVisitCount("-3")).toBe(0)
    expect(parseVisitCount("2.9")).toBe(2)
  })

  it("bumps from the parsed value", () => {
    expect(bumpVisitCount(null)).toBe(1)
    expect(bumpVisitCount("4")).toBe(5)
  })
})

describe("install-prompt: offer threshold", () => {
  const base = { visits: INSTALL_MIN_VISITS, dismissedUntil: 0, now: 1000, standalone: false, canPrompt: true }

  it("offers after the visit threshold when installable", () => {
    expect(shouldOfferInstall(base)).toBe(true)
  })
  it("does not offer before the threshold, in standalone, or without a prompt", () => {
    expect(shouldOfferInstall({ ...base, visits: INSTALL_MIN_VISITS - 1 })).toBe(false)
    expect(shouldOfferInstall({ ...base, standalone: true })).toBe(false)
    expect(shouldOfferInstall({ ...base, canPrompt: false })).toBe(false)
  })

  it("respects the dismissal window", () => {
    expect(shouldOfferInstall({ ...base, dismissedUntil: base.now + 1 })).toBe(false)
    expect(shouldOfferInstall({ ...base, dismissedUntil: base.now })).toBe(true)
  })
})

describe("install-prompt: dismissal window", () => {
  it("dismisses for the configured number of days", () => {
    expect(installDismissedUntil(0)).toBe(INSTALL_DISMISS_DAYS * 86400000)
  })
})
