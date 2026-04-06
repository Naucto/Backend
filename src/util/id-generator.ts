import { IdGeneratorError } from '@util/id-generator.error';

const MIN_ID = 1_000_000;
const MAX_ID = Number.MAX_SAFE_INTEGER;
const MAX_ATTEMPTS = 20;

export function generateRandomId(): number {
  return Math.floor(Math.random() * (MAX_ID - MIN_ID + 1)) + MIN_ID;
}

export async function generateUniqueRandomId(
  existsFn: (id: number) => Promise<boolean>
): Promise<number> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = generateRandomId();
    
    if (!(await existsFn(candidate))) {
      return candidate;
    }
  }
  
  throw new IdGeneratorError(
    `Failed to generate unique random ID after ${MAX_ATTEMPTS} attempts`
  );
}
