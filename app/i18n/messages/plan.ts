/** Texts of the plan area. Keys start with "plan.". */
import type { Message, Translation } from "./define";

export const en = {
  "plan.complimentary.heading": "Complimentary access",
  "plan.complimentary.body":
    "This store has every feature without a subscription. AI usage is still counted, and the monthly allowance below protects against unexpected costs.",
  "plan.unconfigured.heading": "Billing isn't set up yet",
  "plan.unconfigured.body": "All features are available while plans are being prepared.",
  "plan.welcome.heading": "Thanks for choosing a plan",
  "plan.welcome.body": "Your plan is active. You can start translating now.",
  "plan.stale.heading": "We couldn't confirm your plan with Shopify just now",
  "plan.stale.body": "Nothing is blocked because of this. We'll check again automatically.",

  "plan.current.heading": "Current plan",
  "plan.current.headingWithPlan": "Current plan: {plan}",
  "plan.current.none": "none",
  "plan.current.trial": "Free trial until {date}.",
  "plan.current.ends": "Your plan ends on {date}. Your translations stay in your store.",
  "plan.current.pending": "Changes to {plan} at the next billing cycle.",
  "plan.current.usage": "AI characters this month: {month} of {limit} · today: {today}",
  "plan.current.features": "Languages: up to {languages} · Bulk translation: {bulk} · Glossary: {glossary} · Automatic publishing: {autoPublish}",
  "plan.current.yes": "yes",
  "plan.current.no": "no",
  "plan.current.cost": "Estimated AI cost this month (internal): ${cost} at ${rate} per million characters.",
  "plan.current.memory": "Translation memory reuse never counts against your characters.",
  "plan.current.choose": "Choose a plan",
  "plan.current.checkAgain": "Check again",

  "plan.plans.heading": "Plans",
  "plan.plans.name": "Plan",
  "plan.plans.characters": "AI characters / month",
  "plan.plans.bulk": "Bulk",
  "plan.plans.yes": "Yes",
  "plan.plans.no": "No",
} as const satisfies Record<string, Message>;

export const de: Translation<typeof en> = {
  "plan.complimentary.heading": "Kostenloser Zugang",
  "plan.complimentary.body":
    "Dieser Shop hat alle Funktionen ohne Abo. Die KI-Nutzung wird trotzdem gezählt, und das monatliche Kontingent unten schützt vor unerwarteten Kosten.",
  "plan.unconfigured.heading": "Die Abrechnung ist noch nicht eingerichtet",
  "plan.unconfigured.body": "Alle Funktionen sind verfügbar, solange die Tarife vorbereitet werden.",
  "plan.welcome.heading": "Danke, dass du einen Tarif gewählt hast",
  "plan.welcome.body": "Dein Tarif ist aktiv. Du kannst jetzt mit dem Übersetzen beginnen.",
  "plan.stale.heading": "Wir konnten deinen Tarif gerade nicht bei Shopify bestätigen",
  "plan.stale.body": "Dadurch wird nichts blockiert. Wir prüfen es automatisch noch einmal.",

  "plan.current.heading": "Aktueller Tarif",
  "plan.current.headingWithPlan": "Aktueller Tarif: {plan}",
  "plan.current.none": "keiner",
  "plan.current.trial": "Kostenloser Testzeitraum bis {date}.",
  "plan.current.ends": "Dein Tarif endet am {date}. Deine Übersetzungen bleiben in deinem Shop.",
  "plan.current.pending": "Wechselt ab dem nächsten Abrechnungszeitraum zu {plan}.",
  "plan.current.usage": "KI-Zeichen diesen Monat: {month} von {limit} · heute: {today}",
  "plan.current.features":
    "Sprachen: bis zu {languages} · Massenübersetzung: {bulk} · Glossar: {glossary} · Automatisches Veröffentlichen: {autoPublish}",
  "plan.current.yes": "ja",
  "plan.current.no": "nein",
  "plan.current.cost": "Geschätzte KI-Kosten diesen Monat (intern): ${cost} bei ${rate} pro Million Zeichen.",
  "plan.current.memory": "Wiederverwendung aus dem Übersetzungsspeicher zählt nie zu deinen Zeichen.",
  "plan.current.choose": "Tarif wählen",
  "plan.current.checkAgain": "Erneut prüfen",

  "plan.plans.heading": "Tarife",
  "plan.plans.name": "Tarif",
  "plan.plans.characters": "KI-Zeichen / Monat",
  "plan.plans.bulk": "Massenübersetzung",
  "plan.plans.yes": "Ja",
  "plan.plans.no": "Nein",
};
