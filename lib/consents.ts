// Exact wording shown to clients when they give a consent, and stored with the consent.
//
// Rules for editing this file:
//  * The portal must never word anything as regulated advice or a recommendation.
//  * Changing the wording means a new version. Never edit a version that has been used: the text and version are
//    stored with each consent as the record of what was agreed. (Consents recorded under the earlier DRAFT
//    versions stay exactly as they were recorded.)
//  * The server (not the browser) supplies this text when recording a consent.
//  * {firm} is replaced with the partner firm named on the request. It is only ever shown as text, never as markup.

import type { Database } from "@/lib/database.types";

export type ConsentType = Database["public"]["Tables"]["consents"]["Row"]["consent_type"];

type ConsentTemplate = {
  version: string;
  heading: string;
  paragraphs: string[];
  /** Shown as a list under the paragraphs. */
  bullets: string[];
  /** The tick-box label. */
  agreeLabel: string;
  /** Who the information goes to, stored with the consent. */
  recipient: string;
};

/** What the client sees, and what is stored: the template with the firm filled in. */
export type ConsentWording = ConsentTemplate;

export const PARTNER_FIRM_PATTERN = /^[^<>{}\p{Cc}]{2,120}$/u;
export const PARTNER_FIRM_MESSAGE = "Enter the firm's name (2 to 120 characters, without < > { or })";

export const CONSENTS: Record<ConsentType, ConsentTemplate> = {
  lender_share: {
    version: "lender_share-v1",
    heading: "Sharing your information with lenders",
    paragraphs: [
      "Zen Commercial Finance Ltd (trading as ZenFinanceHub) arranges business finance by introducing you to lenders. To do that, we need to share the information and documents you've given us for this application with the lenders we approach for you.",
    ],
    bullets: [
      "We'll only share what's needed for this application, and only with lenders we approach on your behalf.",
      "Lenders will usually run credit and identity checks on the business, and may also check its directors, owners or guarantors. These checks may be recorded on credit files.",
      "We don't lend money ourselves. Each lender decides for itself whether to offer finance, and on what terms.",
      "We may receive a commission from the lender if finance is arranged, and we may charge you a fee if we've agreed one with you in advance. Ask us and we'll tell you how much.",
      "You can withdraw your agreement at any time by telling us. Anything already shared can't be recalled, but we won't send anything further.",
    ],
    agreeLabel:
      "I agree that Zen Commercial Finance Ltd can share the information and documents I've provided with the lenders it approaches for this application, and that those lenders may carry out credit and identity checks. I confirm I'm authorised to agree this for the business, and that anyone else whose details I've provided knows they're being shared.",
    recipient: "Lenders approached by Zen Commercial Finance Ltd for this application",
  },

  regulated_referral: {
    version: "regulated_referral-v1",
    heading: "Being introduced to {firm}",
    paragraphs: [
      "Part of what you've asked about needs a firm that's authorised to do that kind of work. Zen Commercial Finance Ltd doesn't do this work and isn't giving you advice on it.",
    ],
    bullets: [
      "If you agree, we'll pass your name, contact details and the short summary you've given us to {firm} so they can contact you.",
      "{firm} is a separate, independent firm. Any advice they give, or anything you agree with them, is between you and them, and they'll explain how they look after your information.",
      "You don't have to use them, and you're free to go to another firm.",
      "We may receive a fee from {firm} if you become their client. Ask us and we'll tell you how much.",
      "You can change your mind at any time before we make the introduction.",
    ],
    agreeLabel:
      "I agree that Zen Commercial Finance Ltd can pass my name, contact details and summary to {firm} so they can contact me.",
    recipient: "{firm}",
  },

  engagement_letter: {
    version: "engagement_letter-v1",
    heading: "Our engagement letter",
    paragraphs: [
      "Our engagement letter explains the work ZenFinanceHub will do for you, what we need from you, our fees and how we handle your information.",
      "Please read the letter, shown on this page if we have attached it, before you agree. If anything is unclear, send us a message and we will explain it.",
    ],
    bullets: [],
    agreeLabel: "I have read the engagement letter and agree to its terms. I confirm I'm authorised to agree this for the business.",
    recipient: "ZenFinanceHub",
  },
};

/**
 * The wording for one request, with the partner firm filled in. Returns null for a regulated referral whose firm is
 * missing or unusable, so nothing is ever shown or recorded with a blank or unsafe name. (A function is used for the
 * replacement so a firm name containing "$" cannot be misread as a replacement pattern.)
 */
export function wordingFor(type: ConsentType, partnerFirm?: string | null): ConsentWording | null {
  const template = CONSENTS[type];
  if (type !== "regulated_referral") return template;
  const firm = (partnerFirm ?? "").trim();
  if (!PARTNER_FIRM_PATTERN.test(firm)) return null;
  const fill = (s: string) => s.replaceAll("{firm}", () => firm);
  return {
    version: template.version,
    heading: fill(template.heading),
    paragraphs: template.paragraphs.map(fill),
    bullets: template.bullets.map(fill),
    agreeLabel: fill(template.agreeLabel),
    recipient: fill(template.recipient),
  };
}

/** The text stored with the consent: exactly what was on the page. */
export function consentText(wording: ConsentWording): string {
  return [wording.heading, ...wording.paragraphs, wording.bullets.map((b) => `- ${b}`).join("\n"), wording.agreeLabel]
    .filter(Boolean)
    .join("\n\n");
}
