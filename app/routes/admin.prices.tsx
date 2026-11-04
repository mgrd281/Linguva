/**
 * Prices (/admin/prices): the list prices the website and the app's Plan
 * page show. Saving needs the "prices" capability (Owner, Finance), a
 * reason and a fresh authenticator code; savePrices writes the prices,
 * their history and the audit log in one transaction. Shopify charges what
 * the Partner Dashboard says: the page says so before the form. A form read
 * before another save is refused (409) and the page reads the prices again:
 * never a stale form's prices over newer ones.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction, ShouldRevalidateFunctionArgs } from "react-router";
import { data, useActionData, useLoaderData } from "react-router";
import { requireAdmin, verifyFreshCode } from "../.server/admin/auth";
import { InvalidPriceTableError, loadPricesPage, parsePriceForm, pricesChangedSince, savePrices } from "../.server/admin/prices";
import { adminTitle } from "../admin/meta";
import { AdminPageError } from "../components/admin/AdminPageError";
import { PricesView, type PricesActionData, type PricesConflict } from "../components/admin/PricesView";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await requireAdmin(request, "view");
  return { page: await loadPricesPage(), canEdit: ctx.can("prices") };
};

/** What the admin typed (never the code), to show the form again after a refused save. */
function typedValues(form: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, value] of form) {
    if (typeof value === "string" && name !== "code" && name !== "_csrf" && value.length <= 600) values[name] = value;
  }
  return values;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await requireAdmin(request, "prices");
  const form = await request.formData();
  const parsed = parsePriceForm(form);
  if (!parsed.ok) return data<PricesActionData>({ ok: false, errors: parsed.errors, values: typedValues(form) }, { status: 400 });
  // Saved by someone else since this form was read: the current prices, not this form's (and the code stays unused).
  const conflict = (plans: PricesConflict) => {
    const { reason } = typedValues(form);
    return data<PricesActionData>({ ok: false, conflict: plans, errors: {}, values: reason === undefined ? {} : { reason } }, { status: 409 });
  };
  const stale = await pricesChangedSince(parsed.versions);
  if (stale.length > 0) return conflict(stale);
  // A fresh code for every save, refused once used (also counts towards the account lock).
  if (!(await verifyFreshCode(ctx, parsed.code))) {
    return data<PricesActionData>({ ok: false, errors: { code: "CODE_WRONG" }, values: typedValues(form) }, { status: 400 });
  }
  try {
    const result = await savePrices(parsed.table, parsed.reason, { userId: ctx.user.id }, { expected: parsed.versions });
    // A save between the check above and this one's locks.
    if (!result.ok) return conflict(result.conflict);
    return data<PricesActionData>({ ok: true, changed: result.changed, savedAt: new Date().toISOString() });
  } catch (error) {
    // The database refused a value (nothing written): the form says which, never an error page.
    if (error instanceof InvalidPriceTableError) return data<PricesActionData>({ ok: false, errors: { [error.field]: error.code }, values: typedValues(form) }, { status: 400 });
    throw error;
  }
};

/** A refused save keeps the page's data (React Router's default), except a conflict: then the current prices are read again. */
export const shouldRevalidate = ({ actionStatus, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) => actionStatus === 409 || defaultShouldRevalidate;

export const meta: MetaFunction = ({ matches }) => adminTitle(matches, "nav.prices");

export default function AdminPrices() {
  const { page, canEdit } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return <PricesView page={page} canEdit={canEdit} result={result ?? null} />;
}

export const ErrorBoundary = AdminPageError;
