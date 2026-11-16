export function statementIdentity(value: string, year: number) {
  const number = value.trim();
  const numeric = /^(\d+)(?:\s*\/\s*(\d{4}))?$/.exec(number);
  if (!numeric || (numeric[2] && Number(numeric[2]) !== year)) return number;
  return numeric[1].replace(/^0+(?=\d)/, "");
}
