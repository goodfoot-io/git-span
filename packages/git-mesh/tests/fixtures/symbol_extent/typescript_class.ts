// Fixture: a top-level arrow-function lexical_declaration.

export const handler = (input: number): number => {
  let acc = 0;
  for (let i = 0; i < input; i++) {
    acc += i;
  }
  return acc;
};

export class Other {
  run(): void {}
}
