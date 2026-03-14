/** Promisified setTimeout for pacing paginated fetches. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
