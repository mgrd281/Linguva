/**
 * A console page's error boundary: inside the frame (navigation stays), the
 * page's place shows what went wrong (403: the role may not; 404; anything
 * else: try again). Details stay in the server log.
 */
import { isRouteErrorResponse, useRouteError } from "react-router";
import { AdminErrorView, errorKind } from "./Shell";

export function AdminPageError() {
  const error = useRouteError();
  return <AdminErrorView kind={errorKind(isRouteErrorResponse(error) ? error.status : null)} />;
}
