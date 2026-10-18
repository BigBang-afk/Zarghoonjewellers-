import { describe, expect, it } from "vitest";
import { LlmProviderError } from "../../src/agents/llm/llmClient.js";
import { ScriptedLlmClient, textBlock, toolUseBlock } from "../../src/agents/llm/scriptedLlmClient.js";
import {
  createClaudeDrafter,
  createTemplateDrafter,
  formatVerifiedPrice,
  SUBMIT_DRAFT_TOOL,
  templateDraft,
  validateDraft,
  type DraftFacts,
} from "../../src/services/followupEngine/drafting.js";
import { FOLLOWUP_PURPOSES } from "../../src/schemas/crm.js";

const facts = (over: Partial<DraftFacts> = {}): DraftFacts => ({
  businessName: "Zarghoon Jewellers",
  purpose: "bridal",
  purposeLabel: "Bridal customer",
  language: "english",
  languageSource: "customer_preference",
  customerName: "Test Customer",
  products: [{ name: "TEST Bridal Necklace", sku: "TEST-NK-001", price: null, availability: "needs_confirmation" }],
  lastCustomerMessage: { text: "I want a bridal necklace", date: "2026-10-18" },
  staffNote: null,
  ...over,
});

const submit = (message: string, language = "english") =>
  toolUseBlock("submit_draft", { message, language, rationale: "Customer asked about a bridal necklace." });

describe("draft validation (never invent business data)", () => {
  it("13. missing price: any amount is rejected; a verified price is allowed exactly", () => {
    expect(validateDraft("Assalamualaikum! The TEST Bridal Necklace is PKR 450,000. Shall we show you more?", facts()).map((v) => v.code)).toContain("unverified_number");
    expect(validateDraft("Assalamualaikum! It costs around 4.5 lakh. Shall we show you more designs?", facts()).map((v) => v.code)).toContain("unverified_number");
    const priced = facts({ products: [{ name: "TEST Bridal Necklace", sku: "TEST-NK-001", price: "PKR 485,000", availability: "needs_confirmation" }] });
    expect(validateDraft("Assalamualaikum! The TEST Bridal Necklace is PKR 485,000. Would you like to see it?", priced)).toEqual([]);
    expect(validateDraft("Assalamualaikum! The TEST Bridal Necklace is PKR 495,000. Would you like to see it?", priced).map((v) => v.code)).toContain("unverified_number");
  });

  it("14. unknown stock: availability claims are rejected unless stock allows it", () => {
    const text = "Assalamualaikum! Good news, the TEST Bridal Necklace is available now. Shall we reserve a visit?";
    expect(validateDraft(text, facts()).map((v) => v.code)).toContain("unverified_availability");
    const inStock = facts({ products: [{ name: "TEST Bridal Necklace", sku: "TEST-NK-001", price: null, availability: "available" }] });
    expect(validateDraft(text, inStock)).toEqual([]);
  });

  it("rejects discounts, gold rates, delivery promises, urgency, links and wrong language", () => {
    const codes = (t: string, f = facts()) => validateDraft(t, f).map((v) => v.code);
    expect(codes("Assalamualaikum! We have a special discount for you this week on bridal sets.")).toContain("discount_or_offer");
    expect(codes("Assalamualaikum! Today's gold rate is great for buying bridal jewellery.")).toContain("gold_rate");
    expect(codes("Assalamualaikum! We can deliver within two days to your home in Lahore.")).toContain("delivery_promise");
    expect(codes("Assalamualaikum! Hurry, only 1 left of this bridal necklace for you.")).toContain("urgency_or_scarcity");
    expect(codes("Assalamualaikum! See all designs at https://example.com/bridal today.")).toContain("contact_or_link");
    expect(codes("Assalamualaikum! Just following up on the bridal necklace.", facts({ language: "urdu" }))).toContain("wrong_language");
  });

  it("formats verified prices without floats", () => {
    expect(formatVerifiedPrice("485000.00", "PKR")).toBe("PKR 485,000");
    expect(formatVerifiedPrice("12345678901234.50", "PKR")).toBe("PKR 12,345,678,901,234.50");
  });

  it("every template passes validation in every language", () => {
    for (const purpose of FOLLOWUP_PURPOSES) {
      for (const language of ["english", "urdu", "roman_urdu"] as const) {
        const f = facts({ purpose, language });
        expect(validateDraft(templateDraft(f), f), `${purpose}/${language}`).toEqual([]);
      }
    }
  });
});

describe("12. AI drafting (scripted model — no API key needed)", () => {
  it("stores a valid Claude draft with its rationale", async () => {
    const llm = new ScriptedLlmClient([() => [submit("Assalamualaikum Test Customer! Just following up on the TEST Bridal Necklace you liked. Would you like us to show you a few similar designs?")]]);
    const r = await createClaudeDrafter(llm).draft(facts());
    expect(r).toMatchObject({ authorType: "ai", language: "english", validation: { attempts: 1, fallback: false } });
    expect(r.rationale).toMatch(/bridal/);
    // The request carries only the fact sheet and the strict submit tool.
    const req = llm.requests[0]!;
    expect(req.tools).toEqual([SUBMIT_DRAFT_TOOL]);
    expect(SUBMIT_DRAFT_TOOL.strict).toBe(true);
    expect(JSON.stringify(req.messages[0])).toContain("TEST-NK-001");
  });

  it("gets one correction, then falls back to the safe template", async () => {
    const corrected = new ScriptedLlmClient([
      () => [submit("Assalamualaikum! Enjoy a 10% discount on the TEST Bridal Necklace this week!")],
      (req) => {
        const last = req.messages[req.messages.length - 1]!;
        expect(JSON.stringify(last.content)).toMatch(/rejected/);
        return [submit("Assalamualaikum Test Customer! Just following up on the TEST Bridal Necklace. Shall we arrange a visit at your convenience?")];
      },
    ]);
    const ok = await createClaudeDrafter(corrected).draft(facts());
    expect(ok).toMatchObject({ authorType: "ai", validation: { attempts: 2, fallback: false } });
    expect(ok.validation.violations.map((v) => v.code)).toContain("discount_or_offer");

    const stubborn = new ScriptedLlmClient([() => [submit("Hurry, limited stock at PKR 400,000!")], () => [submit("Only 1 left — buy today!")]]);
    const fb = await createClaudeDrafter(stubborn).draft(facts());
    expect(fb).toMatchObject({ authorType: "template", model: "offline-template", validation: { fallback: true } });
    expect(validateDraft(fb.content, facts())).toEqual([]);
  });

  it("a response without the tool, or a refusal, never becomes a draft", async () => {
    const chatty = new ScriptedLlmClient([() => [textBlock("Here is a message: Hello!")]]);
    expect((await createClaudeDrafter(chatty).draft(facts())).authorType).toBe("template");
  });

  it("provider errors propagate (the worker retries) instead of producing an unvalidated draft", async () => {
    const down = new ScriptedLlmClient([() => Promise.reject(new LlmProviderError("down", true))]);
    await expect(createClaudeDrafter(down).draft(facts())).rejects.toBeInstanceOf(LlmProviderError);
  });

  it("drafts in Urdu and Roman Urdu", async () => {
    const urdu = facts({ language: "urdu" });
    const llm = new ScriptedLlmClient([() => [submit("السلام علیکم! آپ نے TEST Bridal Necklace میں دلچسپی ظاہر کی تھی۔ کیا ہم آپ کو اس جیسے مزید ڈیزائن دکھائیں؟", "urdu")]]);
    expect((await createClaudeDrafter(llm).draft(urdu)).authorType).toBe("ai");
    const roman = await createTemplateDrafter().draft(facts({ language: "roman_urdu" }));
    expect(roman.content).toMatch(/^Assalamualaikum Test Customer! Aap ne TEST Bridal Necklace/);
  });
});
