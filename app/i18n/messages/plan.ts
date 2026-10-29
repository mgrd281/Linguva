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
  "plan.current.features": "Languages: up to {languages} · Bulk translation: {bulk} · Glossary: {glossary} · Automatic publishing: {autoPublish} · Smart schedule: {smart}",
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
    "Sprachen: bis zu {languages} · Massenübersetzung: {bulk} · Glossar: {glossary} · Automatisches Veröffentlichen: {autoPublish} · Intelligenter Zeitplan: {smart}",
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

export const fr: Translation<typeof en> = {
  "plan.complimentary.heading": "Accès offert",
  "plan.complimentary.body":
    "Cette boutique dispose de toutes les fonctionnalités sans abonnement. L'utilisation de l'IA est tout de même comptabilisée, et le quota mensuel ci-dessous protège contre les coûts imprévus.",
  "plan.unconfigured.heading": "La facturation n'est pas encore configurée",
  "plan.unconfigured.body": "Toutes les fonctionnalités sont disponibles pendant la préparation des forfaits.",
  "plan.welcome.heading": "Merci d'avoir choisi un forfait",
  "plan.welcome.body": "Votre forfait est actif. Vous pouvez commencer à traduire dès maintenant.",
  "plan.stale.heading": "Nous n'avons pas pu confirmer votre forfait auprès de Shopify pour le moment",
  "plan.stale.body": "Cela ne bloque rien. Nous vérifierons de nouveau automatiquement.",

  "plan.current.heading": "Forfait actuel",
  "plan.current.headingWithPlan": "Forfait actuel : {plan}",
  "plan.current.none": "aucun",
  "plan.current.trial": "Essai gratuit jusqu'au {date}.",
  "plan.current.ends": "Votre forfait prend fin le {date}. Vos traductions restent dans votre boutique.",
  "plan.current.pending": "Passage au forfait {plan} au prochain cycle de facturation.",
  "plan.current.usage": "Caractères IA ce mois-ci : {month} sur {limit} · aujourd'hui : {today}",
  "plan.current.features":
    "Langues : jusqu'à {languages} · Traduction groupée : {bulk} · Glossaire : {glossary} · Publication automatique : {autoPublish} · Planification intelligente : {smart}",
  "plan.current.yes": "oui",
  "plan.current.no": "non",
  "plan.current.cost": "Coût IA estimé ce mois-ci (interne) : {cost} $ à {rate} $ par million de caractères.",
  "plan.current.memory": "La réutilisation de la mémoire de traduction n'est jamais décomptée de vos caractères.",
  "plan.current.choose": "Choisir un forfait",
  "plan.current.checkAgain": "Vérifier à nouveau",

  "plan.plans.heading": "Forfaits",
  "plan.plans.name": "Forfait",
  "plan.plans.characters": "Caractères IA / mois",
  "plan.plans.bulk": "Traduction groupée",
  "plan.plans.yes": "Oui",
  "plan.plans.no": "Non",
};

export const es: Translation<typeof en> = {
  "plan.complimentary.heading": "Acceso gratuito",
  "plan.complimentary.body":
    "Esta tienda tiene todas las funciones sin suscripción. El uso de IA se sigue contabilizando, y la cuota mensual de abajo protege contra costos inesperados.",
  "plan.unconfigured.heading": "La facturación aún no está configurada",
  "plan.unconfigured.body": "Todas las funciones están disponibles mientras se preparan los planes.",
  "plan.welcome.heading": "Gracias por elegir un plan",
  "plan.welcome.body": "Tu plan está activo. Ya puedes empezar a traducir.",
  "plan.stale.heading": "No pudimos confirmar tu plan con Shopify en este momento",
  "plan.stale.body": "Esto no bloquea nada. Volveremos a comprobarlo automáticamente.",

  "plan.current.heading": "Plan actual",
  "plan.current.headingWithPlan": "Plan actual: {plan}",
  "plan.current.none": "ninguno",
  "plan.current.trial": "Prueba gratuita hasta el {date}.",
  "plan.current.ends": "Tu plan termina el {date}. Tus traducciones se quedan en tu tienda.",
  "plan.current.pending": "Cambia al plan {plan} en el próximo ciclo de facturación.",
  "plan.current.usage": "Caracteres de IA este mes: {month} de {limit} · hoy: {today}",
  "plan.current.features":
    "Idiomas: hasta {languages} · Traducción masiva: {bulk} · Glosario: {glossary} · Publicación automática: {autoPublish} · Programación inteligente: {smart}",
  "plan.current.yes": "sí",
  "plan.current.no": "no",
  "plan.current.cost": "Costo estimado de IA este mes (interno): ${cost} a ${rate} por millón de caracteres.",
  "plan.current.memory": "La reutilización de la memoria de traducción nunca cuenta para tus caracteres.",
  "plan.current.choose": "Elegir un plan",
  "plan.current.checkAgain": "Volver a comprobar",

  "plan.plans.heading": "Planes",
  "plan.plans.name": "Plan",
  "plan.plans.characters": "Caracteres de IA / mes",
  "plan.plans.bulk": "Traducción masiva",
  "plan.plans.yes": "Sí",
  "plan.plans.no": "No",
};
