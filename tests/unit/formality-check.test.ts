/**
 * Form of address check: flags the other form than the merchant chose,
 * only on clear markers (no false alarm on ambiguous words).
 */
import { describe, expect, it } from "vitest";
import { formalityMismatch } from "../../app/.server/translation/formality-check";

describe("form of address check", () => {
  it("German: informal words in a formal translation, formal words mid-sentence in an informal one", () => {
    expect(formalityMismatch("de", "more", "Bestelle deine Jacke heute.")).toBe("deine");
    expect(formalityMismatch("de", "more", "Du findest hier alles.")).toBe("Du");
    expect(formalityMismatch("de", "more", "Bestellen Sie Ihre Jacke heute.")).toBeNull();
    expect(formalityMismatch("de", "less", "Wir senden Ihnen die Jacke.")).toBe("Ihnen");
    expect(formalityMismatch("de", "less", "Hier finden Sie alles.")).toBe("Sie");
    // "Sie" at the start of a sentence can mean "they"; lowercase "sie" is "she/they".
    expect(formalityMismatch("de", "less", "Sie ist warm. Die Jacken sind leicht, sie halten warm.")).toBeNull();
    expect(formalityMismatch("de", "less", "Bestelle deine Jacke.")).toBeNull();
    // Words that merely contain the markers don't count.
    expect(formalityMismatch("de", "more", "Dudelsack und Direktor")).toBeNull();
  });

  it("French, Spanish, Italian and Dutch, with regional codes", () => {
    expect(formalityMismatch("fr", "more", "Commande ta veste, tu vas l'adorer.")).toBe("tu");
    expect(formalityMismatch("fr-CA", "more", "Nous t'envoyons la veste.")).toBe("t'");
    expect(formalityMismatch("fr", "more", "Commandez votre veste, vous allez l'adorer.")).toBeNull();
    expect(formalityMismatch("es-MX", "more", "Esta chaqueta es para ti y tus amigos.")).toBe("tus");
    expect(formalityMismatch("es", "less", "Usted puede pedir hoy.")).toBe("Usted");
    expect(formalityMismatch("it", "more", "La tua giacca arriva domani.")).toBe("tua");
    expect(formalityMismatch("nl", "more", "Bestel jouw jas vandaag.")).toBe("jouw");
    expect(formalityMismatch("nl", "less", "Bestel uw jas vandaag.")).toBe("uw");
  });

  it("does nothing for languages without clear markers", () => {
    expect(formalityMismatch("ja", "more", "あなたのジャケット")).toBeNull();
    expect(formalityMismatch("pt-BR", "more", "Peça a sua jaqueta hoje.")).toBeNull();
  });
});
