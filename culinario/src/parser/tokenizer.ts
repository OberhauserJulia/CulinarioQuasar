export function tokenize(text: string, excludeSpaces: boolean = true): string[] {
  // 1. Deutsche Kommazahlen reparieren (macht aus "1,5" -> "1.5", damit die Mathematik nicht kaputt geht)
  let processedText = text.replace(/(\d),(\d)/g, '$1.$2');

  // 2. Aneinanderklebende Zahlen und Buchstaben trennen (macht aus "200g" -> "200 g")
  processedText = processedText.replace(/(\d)([a-zA-ZäöüÄÖÜß])/g, '$1 $2');

  // Das Minus (-) steht jetzt ganz am Ende, so braucht es kein Escape-Zeichen mehr.
  // Der Slash (/) muss im Regex-Literal escaped werden (\/).
  const rawTokens = processedText.split(/([ ,/()-])/).filter(t => t !== '');

  if (excludeSpaces) {
    return rawTokens.filter(t => t.trim() !== '');
  }
  return rawTokens;
}
