export function formatCurrency(amount: number): string {
  return `\u00a3${amount.toFixed(2)}`;
}
