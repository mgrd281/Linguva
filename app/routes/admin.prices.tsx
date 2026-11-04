/**
 * Prices (/admin/prices): the list prices the website and the app's Plan
 * page show. Saving needs the "prices" capability (Owner, Finance), a
 * reason and a fresh authenticator code; savePrices writes the prices,
 * their history and the audit log in one transaction. Shopify charges what
 * the Partner Dashboard says: the page says so before the form.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, useActionData, useLoaderData } from "react-router";
import { requireAdmin, verifyFreshCode } from "../.server/admin/auth";
import { loadPricesPage, parsePriceForm, savePrices } from "../.server/admin/prices";
import { adminTitle } from "../admin/meta";
import { AdminPageError } from "../components/admin/AdminPageError";
import { PricesView, type PricesActionData } from "../components/admin/PricesView";

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
  // A fresh code for every save, refused once used (also counts towards the account lock).
  if (!(await verifyFreshCode(ctx, parsed.code))) {
    return data<PricesActionData>({ ok: false, errors: { code: "CODE_WRONG" }, values: typedValues(form) }, { status: 400 });
  }
  const { changed } = await savePrices(parsed.table, parsed.reason, { userId: ctx.user.id });
  return data<PricesActionData>({ ok: true, changed, savedAt: new Date().toISOString() });
};

export const meta: MetaFunction = ({ matches }) => adminTitle(matches, "nav.prices");

export default function AdminPrices() {
  const { page, canEdit } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return <PricesView page={page} canEdit={canEdit} result={result ?? null} />;
}

export const ErrorBoundary = AdminPageError;
