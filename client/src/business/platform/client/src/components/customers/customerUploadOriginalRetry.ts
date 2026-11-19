// A brand is issued only AFTER the original upload's own persistent lock has
// been successfully released for a server-confirmed "not saved" rejection.
// The existing native factory provides these same functions and WeakSet.
const releasedOriginalRejections = new WeakSet<object>();

export function __customerUploadRetry20261119_originalNotSavedAfterRelease(error: { message: string }): Error {
  const released = new Error(error.message);
  releasedOriginalRejections.add(released);
  return released;
}

export function __customerUploadRetry20261119_isReleasedOriginalRejection(error: unknown): boolean {
  return typeof error === "object" && error !== null && releasedOriginalRejections.has(error);
}
