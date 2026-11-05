// The type of books.json (an "arbitrary extension" declaration: TypeScript reads this instead of inferring a type from the 1.9 MB file).
import type { BookData } from "../src/books";

declare const data: BookData;
export default data;
