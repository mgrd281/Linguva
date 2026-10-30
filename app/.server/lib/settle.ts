/** Promise.all that rejects (with the first rejection) only once every promise has settled. */
export async function settleAll<T extends readonly unknown[] | []>(values: T): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
  const settled = (await Promise.allSettled(values)) as unknown as Array<PromiseSettledResult<unknown>>;
  const failed = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
  return settled.map((result) => (result as PromiseFulfilledResult<unknown>).value) as { -readonly [P in keyof T]: Awaited<T[P]> };
}
