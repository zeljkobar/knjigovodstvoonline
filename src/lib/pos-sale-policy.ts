const posSubmissionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidPosSubmissionId(value: string) {
  return posSubmissionIdPattern.test(value);
}

export function buildPosSaleIdempotencyKey(
  firmaId: string,
  submissionId: string
) {
  return `pos:${firmaId}:${submissionId}`;
}
