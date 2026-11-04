/**
 * Activity: who changed which list price, when and why, and the recent
 * sign-ins to the console (active or ended; a card per sign-in on a phone).
 */
import { ROLE_LABEL } from "../../admin/labels";
import type { SignInView } from "../../.server/admin/activity";
import type { PriceChangeView } from "../../.server/admin/prices";
import { useAdminI18n } from "./context";
import { PriceHistory } from "./PricesView";
import { Badge, Card, CardTables, EmptyState, PageHeader, Table } from "./ui";

export interface ActivityData {
  priceChanges: PriceChangeView[];
  signIns: SignInView[];
}

export function ActivityView({ priceChanges, signIns }: ActivityData) {
  const i18n = useAdminI18n();
  const { t } = i18n;
  return (
    <>
      <PageHeader title={t("activity.title")} lead={t("activity.lead")} />
      <Card id="price-changes" icon="tag" title={t("activity.pricesTitle")} flush>
        <CardTables columns={2}>
          <PriceHistory changes={priceChanges} />
        </CardTables>
      </Card>
      <Card id="sign-ins" icon="user" title={t("activity.signInsTitle")} lead={t("activity.keptNote")} flush>
        {signIns.length === 0 ? (
          <EmptyState icon="user" title={t("activity.signInsEmpty")} />
        ) : (
          <Table caption={t("activity.signInsCaption")} cards={2}>
            <thead>
              <tr>
                <th scope="col">{t("activity.colWho")}</th>
                <th scope="col">{t("activity.colRole")}</th>
                <th scope="col">{t("activity.colAt")}</th>
                <th scope="col">{t("activity.colSeen")}</th>
                <th scope="col">{t("activity.colSession")}</th>
              </tr>
            </thead>
            <tbody>
              {signIns.map((signIn, index) => (
                <tr key={`${signIn.at}-${index}`}>
                  <th scope="row">
                    <bdi className="adm-truncate">{signIn.email}</bdi>
                  </th>
                  <td>{t(ROLE_LABEL[signIn.role])}</td>
                  <td className="adm-nowrap">{i18n.dateTime(signIn.at)}</td>
                  <td className="adm-nowrap adm-muted">{i18n.dateTime(signIn.lastSeenAt)}</td>
                  <td>
                    <Badge tone={signIn.state === "active" ? "success" : "neutral"} icon={signIn.state === "active" ? "check" : "minus"}>
                      {signIn.state === "active" ? t("activity.active") : t("activity.ended")}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="adm-footnote">{t("common.utcNote")}</p>
    </>
  );
}
