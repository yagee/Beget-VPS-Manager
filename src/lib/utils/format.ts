export function formatPrice(value: number): string {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatGigabytes(valueInMb: number): string {
  const valueInGb = valueInMb / 1024;

  return formatGigabyteValue(valueInGb);
}

export function formatGigabyteValue(valueInGb: number): string {
  const normalizedValue = Object.is(valueInGb, -0) ? 0 : valueInGb;

  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: normalizedValue % 1 === 0 ? 0 : 1,
  }).format(normalizedValue);
}

export function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}
