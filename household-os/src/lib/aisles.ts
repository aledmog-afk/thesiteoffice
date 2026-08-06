// Keyword -> aisle lookup for auto-categorizing free-text shopping items.
// Deliberately simple (no external API): first matching keyword wins.

const AISLE_KEYWORDS: Record<string, string[]> = {
  Produce: [
    "apple", "banana", "orange", "lettuce", "tomato", "onion", "potato", "carrot",
    "pepper", "avocado", "garlic", "lemon", "lime", "spinach", "broccoli", "cucumber",
    "grape", "berry", "berries", "herbs", "mushroom", "celery",
  ],
  Dairy: [
    "milk", "cheese", "yogurt", "yoghurt", "butter", "cream", "egg", "eggs", "margarine",
  ],
  Meat: [
    "chicken", "beef", "pork", "bacon", "sausage", "turkey", "lamb", "ham", "mince",
    "steak", "fish", "salmon", "shrimp", "prawn",
  ],
  Bakery: ["bread", "bagel", "bun", "roll", "croissant", "muffin", "tortilla", "pita"],
  Frozen: ["frozen", "ice cream", "fries", "pizza"],
  Pantry: [
    "pasta", "rice", "flour", "sugar", "salt", "cereal", "oil", "sauce", "beans",
    "soup", "can", "canned", "spice", "coffee", "tea", "honey", "jam", "peanut butter",
    "cracker", "snack", "chips", "nuts",
  ],
  Beverages: ["water", "juice", "soda", "wine", "beer", "coffee", "cola"],
  Household: [
    "detergent", "soap", "paper towel", "toilet paper", "tissue", "trash bag",
    "cleaner", "sponge", "foil", "wrap", "batteries", "lightbulb",
  ],
  "Health & Beauty": ["shampoo", "toothpaste", "deodorant", "vitamins", "medicine", "razor"],
};

export function categorizeAisle(itemName: string): string {
  const name = itemName.toLowerCase();
  for (const [aisle, keywords] of Object.entries(AISLE_KEYWORDS)) {
    if (keywords.some((keyword) => name.includes(keyword))) {
      return aisle;
    }
  }
  return "Other";
}

export const AISLE_ORDER = [
  "Produce",
  "Dairy",
  "Meat",
  "Bakery",
  "Frozen",
  "Pantry",
  "Beverages",
  "Household",
  "Health & Beauty",
  "Other",
];
