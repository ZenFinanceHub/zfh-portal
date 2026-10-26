// Exact wording shown to clients when they give a consent, and stored with the consent.
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ ALL WORDING BELOW IS A DRAFT FOR CRAIG TO REVIEW before real clients use it.│
// └───────────────────────────────────────────────────────────────────────────┘
//
// Rules for editing this file:
//  * The portal must never word anything as regulated advice or a recommendation.
//  * Changing the wording means bumping `version`. Never edit a version that has been used:
//    the text and version are stored with each consent as the record of what was agreed.
//  * The server (not the browser) supplies this text when recording a consent.

import type { Database } from "@/lib/database.types";

export type ConsentType = Database["public"]["Tables"]["consents"]["Row"]["consent_type"];

export type ConsentWording = {
  /** Stored with the consent. Contains DRAFT until the wording is signed off. */
  version: string;
  heading: string;
  paragraphs: string[];
  /** The tick-box label. */
  agreeLabel: string;
  /** Who the information goes to, stored with the consent. */
  recipient: string;
};

export const CONSENTS: Record<ConsentType, ConsentWording> = {
  lender_share: {
    version: "lender_share-DRAFT-2026-10-26",
    heading: "Sharing your information with lenders",
    paragraphs: [
      "To ask lenders about finance for you, ZenFinanceHub needs to send them the information and documents you have given us for this application.",
      "We will only share what is needed for this purpose, and only with lenders we approach on your behalf for this application.",
      "ZenFinanceHub arranges introductions. We do not lend money ourselves, and each lender makes its own decision about whether to offer you finance.",
      "You can change your mind at any time by telling us. Anything already sent to a lender cannot be taken back, but we will not send anything further.",
    ],
    agreeLabel:
      "I agree that ZenFinanceHub can share the information and documents I have provided with the lenders it approaches for this application.",
    recipient: "Lenders approached by ZenFinanceHub for this application",
  },

  regulated_referral: {
    version: "regulated_referral-DRAFT-2026-10-26",
    heading: "Being introduced to our partner firm",
    paragraphs: [
      "For this part of your request, we work with a separate partner firm that is authorised to deal with it. ZenFinanceHub does not do this work itself.",
      "If you agree, we will pass your name, contact details and the short summary you have given us to that firm so they can get in touch with you.",
      "The partner firm is independent of ZenFinanceHub. Anything they tell you, or agree with you, is between you and them. You do not have to use their services, and you are free to speak to other firms instead.",
      "You can change your mind at any time by telling us before we make the introduction.",
    ],
    agreeLabel:
      "I agree that ZenFinanceHub can pass my name, contact details and summary to its partner firm so they can contact me.",
    recipient: "Partner firm introduced by ZenFinanceHub",
  },

  engagement_letter: {
    version: "engagement_letter-DRAFT-2026-10-26",
    heading: "Our engagement letter",
    paragraphs: [
      "Our engagement letter explains the work ZenFinanceHub will do for you, what we need from you, our fees and how we handle your information.",
      "Please read the letter, shown on this page if we have attached it, before you agree. If anything is unclear, send us a message and we will explain it.",
    ],
    agreeLabel: "I have read the engagement letter and I agree to its terms.",
    recipient: "ZenFinanceHub",
  },
};

export function consentText(type: ConsentType): string {
  const w = CONSENTS[type];
  return [w.heading, ...w.paragraphs, w.agreeLabel].join("\n\n");
}
