import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanDraftGreeting } from "../lib/format";

test("cleanDraftGreeting replaces an email-address greeting with Hello", () => {
  const draft = "Dear angryclient@protonmail.com,\n\nThank you for reaching out.";
  assert.equal(
    cleanDraftGreeting(draft),
    "Hello,\n\nThank you for reaching out.",
  );
});

test("cleanDraftGreeting leaves real-name greetings untouched", () => {
  const draft = "Dear Ray,\n\nThanks for your email.";
  assert.equal(cleanDraftGreeting(draft), draft);
});

test("cleanDraftGreeting passes through null", () => {
  assert.equal(cleanDraftGreeting(null), null);
});
