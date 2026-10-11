/**
 * Word lists are copied unchanged from dariusk/corpora, which is public domain (CC0):
 * https://github.com/dariusk/corpora/blob/master/data/words/adjs.json
 * https://github.com/dariusk/corpora/blob/master/data/words/personal_nouns.json
 */
import adjsFile from "./words/adjs.json" with { type: "json" };
import personalNounsFile from "./words/personal_nouns.json" with { type: "json" };

function pick<T>(items: readonly T[]): T {
    return items[Math.floor(Math.random() * items.length)];
}

export function randomMockName(): string {
    return `${pick(adjsFile.adjs)} ${pick(personalNounsFile.personalNouns)} (Mock)`;
}
