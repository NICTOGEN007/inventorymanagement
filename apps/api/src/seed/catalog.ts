import {
  FESTIVAL_CALENDAR,
  type Festival,
  type GstRate,
  type Role,
  type StateCode,
  type Unit,
} from '@ims/shared';

/**
 * Demo catalogue for a neighbourhood supermarket in Bengaluru.
 * Brands and businesses are fictional. HSN codes are real; GST rates follow the
 * post-September-2025 slabs and are illustrative, not tax advice.
 */

export const SHOP = {
  shopName: 'StockSmart Demo Mart',
  legalName: 'StockSmart Retail Private Limited',
  /** PAN-based part of the GSTIN; the check character is computed. */
  gstinBody: '29AABCS1234K1Z',
  stateCode: '29' as StateCode,
  address: {
    line1: '12, 4th Cross, HAL 2nd Stage',
    line2: 'Indiranagar',
    city: 'Bengaluru',
    pincode: '560038',
  },
  phone: '9876543210',
  email: 'billing@stocksmart.test',
  invoiceFooter:
    'Thank you for shopping with us! Goods once sold can be returned within 7 days with the bill.',
};

export interface DemoUser {
  key: string;
  name: string;
  email: string;
  role: Role;
  password: string;
}

/** Demo logins, printed by the seed script. Never use these passwords in production. */
// prettier-ignore
export const DEMO_USERS: readonly DemoUser[] = [
  { key: 'admin', name: 'Asha Rao', email: 'admin@stocksmart.test', role: 'admin', password: 'Admin@123' },
  { key: 'manager', name: 'Vikram Shetty', email: 'manager@stocksmart.test', role: 'manager', password: 'Manager@123' },
  { key: 'cashier1', name: 'Priya Nair', email: 'cashier@stocksmart.test', role: 'cashier', password: 'Cashier@123' },
  { key: 'cashier2', name: 'Rahul Gowda', email: 'cashier2@stocksmart.test', role: 'cashier', password: 'Cashier@123' },
];

export const CATEGORIES = [
  {
    key: 'STP',
    name: 'Staples & Grains',
    description: 'Rice, flour, pulses, oil, sugar, spices and dry fruits',
  },
  { key: 'BEV', name: 'Beverages', description: 'Tea, coffee, soft drinks, juices and water' },
  {
    key: 'SNK',
    name: 'Snacks & Confectionery',
    description: 'Biscuits, chips, namkeen, chocolates and instant food',
  },
  { key: 'DRY', name: 'Dairy', description: 'Milk, curd, butter, paneer and ghee' },
  { key: 'PRC', name: 'Personal Care', description: 'Soap, shampoo, toothpaste and hygiene' },
  { key: 'HHC', name: 'Household Cleaning', description: 'Detergents, cleaners and repellents' },
  { key: 'STN', name: 'Stationery', description: 'Notebooks, pens and cards' },
  {
    key: 'ELC',
    name: 'Electronics & Accessories',
    description: 'Batteries, bulbs, cables and earphones',
  },
] as const;

export type CategoryKey = (typeof CATEGORIES)[number]['key'];

export interface SupplierDef {
  key: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  gstinBody: string;
  stateCode: StateCode;
  city: string;
  pincode: string;
  leadTimeDays: number;
}

export const SUPPLIERS: readonly SupplierDef[] = [
  {
    key: 'agro',
    name: 'Karnataka Agro Distributors',
    contactPerson: 'Manjunath K',
    phone: '9845012345',
    email: 'orders@kaagro.test',
    gstinBody: '29AAFFK2345M1Z',
    stateCode: '29',
    city: 'Bengaluru',
    pincode: '560002',
    leadTimeDays: 3,
  },
  {
    key: 'bev',
    name: 'Coastal Beverages Pvt Ltd',
    contactPerson: 'Deepa Kamath',
    phone: '9886023456',
    email: 'sales@coastalbev.test',
    gstinBody: '29AACCC3456N1Z',
    stateCode: '29',
    city: 'Mangaluru',
    pincode: '575001',
    leadTimeDays: 4,
  },
  {
    key: 'dairy',
    name: 'Greenfield Dairy Co-operative',
    contactPerson: 'Suresh Hegde',
    phone: '9900134567',
    email: 'supply@greenfielddairy.test',
    gstinBody: '29AABAG4567P1Z',
    stateCode: '29',
    city: 'Bengaluru',
    pincode: '560029',
    leadTimeDays: 1,
  },
  {
    key: 'fmcg',
    name: 'Western FMCG Traders',
    contactPerson: 'Amit Kulkarni',
    phone: '9822045678',
    email: 'orders@westernfmcg.test',
    gstinBody: '27AAFFW5678Q1Z',
    stateCode: '27',
    city: 'Pune',
    pincode: '411001',
    leadTimeDays: 6,
  },
  {
    key: 'snacks',
    name: 'Southern Snacks & Foods',
    contactPerson: 'Lakshmi Iyer',
    phone: '9840056789',
    email: 'trade@southernsnacks.test',
    gstinBody: '33AACCS6789R1Z',
    stateCode: '33',
    city: 'Chennai',
    pincode: '600017',
    leadTimeDays: 5,
  },
  {
    key: 'metro',
    name: 'Metro Office & Electronics Supply',
    contactPerson: 'Farhan Ali',
    phone: '9741067890',
    email: 'b2b@metrosupply.test',
    gstinBody: '29AAFFM7890S1Z',
    stateCode: '29',
    city: 'Bengaluru',
    pincode: '560009',
    leadTimeDays: 7,
  },
];

/** Demand shapes used by the simulation (and later detected by the forecasting engine). */
export type Season = 'summer' | 'winter' | 'monsoon' | 'school' | 'festival';
export type Trend = 'stable' | 'growing' | 'declining';

export interface ProductDef {
  sku: string;
  name: string;
  category: CategoryKey;
  brand: string;
  unit: Unit;
  hsnCode: string;
  gstRate: GstRate;
  /** Printed MRP in rupees (per unit; per kg for loose goods). */
  mrp: number;
  /** Selling price as a fraction of MRP (1 = sold at MRP). */
  priceFactor?: number;
  /** Retail margin on the pre-tax price; cost = taxable price × (1 − margin). */
  margin: number;
  supplier: string;
  /** Relative popularity: how often it lands in a basket. */
  popularity: number;
  trend?: Trend;
  season?: Season;
  /** Typical quantities per basket line. */
  quantities?: readonly number[];
  /** Stops selling this many days before today (dead stock demo). */
  deadForDays?: number;
  /** Not reordered in the last weeks, so it shows up as low / out of stock (demo). */
  lowStockDemo?: boolean;
}

const LOOSE = [0.5, 1, 1, 1, 2, 2, 5] as const;
const MULTI = [1, 1, 1, 2, 2, 3, 4] as const;

// prettier-ignore
export const PRODUCTS: readonly ProductDef[] = [
  // Staples & Grains
  { sku: 'STP-001', name: 'Basmati Rice 5 kg', category: 'STP', brand: 'HarvestCrown', unit: 'pcs', hsnCode: '1006', gstRate: 5, mrp: 649, priceFactor: 0.95, margin: 0.12, supplier: 'agro', popularity: 3 },
  { sku: 'STP-002', name: 'Whole Wheat Atta 10 kg', category: 'STP', brand: 'HarvestCrown', unit: 'pcs', hsnCode: '1101', gstRate: 5, mrp: 499, margin: 0.1, supplier: 'agro', popularity: 3.5 },
  { sku: 'STP-003', name: 'Toor Dal 1 kg', category: 'STP', brand: 'FarmFresh', unit: 'pcs', hsnCode: '0713', gstRate: 5, mrp: 179, margin: 0.14, supplier: 'agro', popularity: 4 },
  { sku: 'STP-004', name: 'Sugar (loose)', category: 'STP', brand: 'Loose', unit: 'kg', hsnCode: '1701', gstRate: 5, mrp: 48, margin: 0.08, supplier: 'agro', popularity: 5, season: 'festival', quantities: LOOSE },
  { sku: 'STP-005', name: 'Iodised Salt 1 kg', category: 'STP', brand: 'FarmFresh', unit: 'pcs', hsnCode: '2501', gstRate: 0, mrp: 28, margin: 0.15, supplier: 'agro', popularity: 3 },
  { sku: 'STP-006', name: 'Sunflower Oil 1 L', category: 'STP', brand: 'SunGold', unit: 'pcs', hsnCode: '1512', gstRate: 5, mrp: 165, margin: 0.09, supplier: 'agro', popularity: 5, quantities: MULTI, lowStockDemo: true },
  { sku: 'STP-007', name: 'Turmeric Powder 200 g', category: 'STP', brand: 'SpiceTrail', unit: 'pcs', hsnCode: '0910', gstRate: 5, mrp: 62, margin: 0.22, supplier: 'agro', popularity: 2 },
  { sku: 'STP-008', name: 'Almonds 500 g', category: 'STP', brand: 'NutriNest', unit: 'pcs', hsnCode: '0802', gstRate: 5, mrp: 549, margin: 0.2, supplier: 'agro', popularity: 1, season: 'festival' },
  { sku: 'STP-009', name: 'Cashews 250 g', category: 'STP', brand: 'NutriNest', unit: 'pcs', hsnCode: '0801', gstRate: 5, mrp: 349, margin: 0.2, supplier: 'agro', popularity: 0.8, season: 'festival' },
  { sku: 'STP-010', name: 'Poha 1 kg', category: 'STP', brand: 'FarmFresh', unit: 'pcs', hsnCode: '1904', gstRate: 5, mrp: 70, margin: 0.18, supplier: 'agro', popularity: 2 },

  // Beverages
  { sku: 'BEV-001', name: 'Tea Leaves 500 g', category: 'BEV', brand: 'HillLeaf', unit: 'pcs', hsnCode: '0902', gstRate: 5, mrp: 285, margin: 0.16, supplier: 'bev', popularity: 4, season: 'winter' },
  { sku: 'BEV-002', name: 'Instant Coffee 100 g', category: 'BEV', brand: 'BeanBrew', unit: 'pcs', hsnCode: '2101', gstRate: 5, mrp: 310, margin: 0.16, supplier: 'bev', popularity: 2, season: 'winter' },
  { sku: 'BEV-003', name: 'Cola 750 ml', category: 'BEV', brand: 'FizzUp', unit: 'pcs', hsnCode: '2202', gstRate: 40, mrp: 45, margin: 0.18, supplier: 'bev', popularity: 4, season: 'summer', quantities: MULTI },
  { sku: 'BEV-004', name: 'Lemon Soda 600 ml', category: 'BEV', brand: 'FizzUp', unit: 'pcs', hsnCode: '2202', gstRate: 40, mrp: 40, margin: 0.18, supplier: 'bev', popularity: 2.5, season: 'summer', trend: 'growing', quantities: MULTI, lowStockDemo: true },
  { sku: 'BEV-005', name: 'Packaged Drinking Water 1 L', category: 'BEV', brand: 'AquaPure', unit: 'pcs', hsnCode: '2201', gstRate: 5, mrp: 20, margin: 0.3, supplier: 'bev', popularity: 6, season: 'summer', quantities: MULTI },
  { sku: 'BEV-006', name: 'Mango Juice 1 L', category: 'BEV', brand: 'OrchardJoy', unit: 'pcs', hsnCode: '2009', gstRate: 5, mrp: 125, margin: 0.18, supplier: 'bev', popularity: 1.5, season: 'summer' },
  { sku: 'BEV-007', name: 'Energy Drink 250 ml', category: 'BEV', brand: 'VoltRush', unit: 'pcs', hsnCode: '2202', gstRate: 40, mrp: 125, margin: 0.2, supplier: 'bev', popularity: 1.2, trend: 'growing' },

  // Snacks & Confectionery
  { sku: 'SNK-001', name: 'Cream Biscuits 150 g', category: 'SNK', brand: 'CrunchTime', unit: 'pcs', hsnCode: '1905', gstRate: 5, mrp: 30, margin: 0.15, supplier: 'snacks', popularity: 6, quantities: MULTI },
  { sku: 'SNK-002', name: 'Salted Potato Chips 90 g', category: 'SNK', brand: 'CrunchTime', unit: 'pcs', hsnCode: '2005', gstRate: 5, mrp: 50, margin: 0.18, supplier: 'snacks', popularity: 5, trend: 'growing', quantities: MULTI },
  { sku: 'SNK-003', name: 'Masala Namkeen 400 g', category: 'SNK', brand: 'DesiBite', unit: 'pcs', hsnCode: '2106', gstRate: 5, mrp: 110, margin: 0.18, supplier: 'snacks', popularity: 3, season: 'festival' },
  { sku: 'SNK-004', name: 'Milk Chocolate Bar 50 g', category: 'SNK', brand: 'CocoaJoy', unit: 'pcs', hsnCode: '1806', gstRate: 5, mrp: 60, margin: 0.2, supplier: 'snacks', popularity: 3, season: 'festival', quantities: MULTI },
  { sku: 'SNK-005', name: 'Instant Noodles (4-pack)', category: 'SNK', brand: 'QuickBowl', unit: 'pack', hsnCode: '1902', gstRate: 5, mrp: 56, margin: 0.14, supplier: 'snacks', popularity: 5, quantities: MULTI },
  { sku: 'SNK-006', name: 'Tomato Ketchup 1 kg', category: 'SNK', brand: 'RedRipe', unit: 'pcs', hsnCode: '2103', gstRate: 5, mrp: 145, margin: 0.16, supplier: 'snacks', popularity: 1.5 },
  { sku: 'SNK-007', name: 'Gulab Jamun Mix 200 g', category: 'SNK', brand: 'DesiBite', unit: 'pcs', hsnCode: '1901', gstRate: 5, mrp: 99, margin: 0.2, supplier: 'snacks', popularity: 0.8, season: 'festival' },

  // Dairy
  { sku: 'DRY-001', name: 'Toned Milk 1 L', category: 'DRY', brand: 'Greenfield', unit: 'pcs', hsnCode: '0401', gstRate: 0, mrp: 56, margin: 0.06, supplier: 'dairy', popularity: 8, quantities: MULTI },
  { sku: 'DRY-002', name: 'Butter 500 g', category: 'DRY', brand: 'Greenfield', unit: 'pcs', hsnCode: '0405', gstRate: 5, mrp: 285, margin: 0.08, supplier: 'dairy', popularity: 2 },
  { sku: 'DRY-003', name: 'Paneer 200 g', category: 'DRY', brand: 'Greenfield', unit: 'pcs', hsnCode: '0406', gstRate: 0, mrp: 95, margin: 0.1, supplier: 'dairy', popularity: 2.5 },
  { sku: 'DRY-004', name: 'Curd 400 g', category: 'DRY', brand: 'Greenfield', unit: 'pcs', hsnCode: '0403', gstRate: 5, mrp: 40, margin: 0.1, supplier: 'dairy', popularity: 3, season: 'summer' },
  { sku: 'DRY-005', name: 'Ghee 1 L', category: 'DRY', brand: 'Greenfield', unit: 'pcs', hsnCode: '0405', gstRate: 5, mrp: 650, margin: 0.08, supplier: 'dairy', popularity: 1.2, season: 'festival' },

  // Personal Care
  { sku: 'PRC-001', name: 'Bath Soap (4 × 100 g)', category: 'PRC', brand: 'DailyCare', unit: 'pack', hsnCode: '3401', gstRate: 5, mrp: 180, margin: 0.18, supplier: 'fmcg', popularity: 3 },
  { sku: 'PRC-002', name: 'Anti-dandruff Shampoo 340 ml', category: 'PRC', brand: 'DailyCare', unit: 'pcs', hsnCode: '3305', gstRate: 5, mrp: 345, margin: 0.2, supplier: 'fmcg', popularity: 1.5, trend: 'growing', lowStockDemo: true },
  { sku: 'PRC-003', name: 'Toothpaste 150 g', category: 'PRC', brand: 'BrightSmile', unit: 'pcs', hsnCode: '3306', gstRate: 5, mrp: 105, margin: 0.18, supplier: 'fmcg', popularity: 3 },
  { sku: 'PRC-004', name: 'Hand Wash Refill 750 ml', category: 'PRC', brand: 'DailyCare', unit: 'pcs', hsnCode: '3401', gstRate: 5, mrp: 149, margin: 0.2, supplier: 'fmcg', popularity: 1.5, trend: 'declining' },

  // Household Cleaning
  { sku: 'HHC-001', name: 'Detergent Powder 2 kg', category: 'HHC', brand: 'Sparkle', unit: 'pcs', hsnCode: '3402', gstRate: 18, mrp: 299, margin: 0.16, supplier: 'fmcg', popularity: 2.5 },
  { sku: 'HHC-002', name: 'Dishwash Liquid 500 ml', category: 'HHC', brand: 'Sparkle', unit: 'pcs', hsnCode: '3402', gstRate: 18, mrp: 115, margin: 0.18, supplier: 'fmcg', popularity: 2.5 },
  { sku: 'HHC-003', name: 'Floor Cleaner 1 L', category: 'HHC', brand: 'Sparkle', unit: 'pcs', hsnCode: '3402', gstRate: 18, mrp: 199, margin: 0.2, supplier: 'fmcg', popularity: 1.5 },
  { sku: 'HHC-004', name: 'Mosquito Repellent Refill', category: 'HHC', brand: 'NightGuard', unit: 'pcs', hsnCode: '3808', gstRate: 18, mrp: 85, margin: 0.2, supplier: 'fmcg', popularity: 1.5, season: 'monsoon' },

  // Stationery
  { sku: 'STN-001', name: 'Ruled Notebook 172 pages', category: 'STN', brand: 'ScribeMate', unit: 'pcs', hsnCode: '4820', gstRate: 0, mrp: 60, margin: 0.25, supplier: 'metro', popularity: 2, season: 'school', quantities: MULTI },
  { sku: 'STN-002', name: 'Ball Pens (pack of 10)', category: 'STN', brand: 'ScribeMate', unit: 'pack', hsnCode: '9608', gstRate: 18, mrp: 100, margin: 0.25, supplier: 'metro', popularity: 1.2, season: 'school' },
  { sku: 'STN-003', name: 'Greeting Cards (pack of 5)', category: 'STN', brand: 'ScribeMate', unit: 'pack', hsnCode: '4909', gstRate: 18, mrp: 120, margin: 0.3, supplier: 'metro', popularity: 0.4, deadForDays: 150 },

  // Electronics & Accessories
  { sku: 'ELC-001', name: 'AA Alkaline Batteries (4-pack)', category: 'ELC', brand: 'VoltEdge', unit: 'pack', hsnCode: '8506', gstRate: 18, mrp: 160, margin: 0.22, supplier: 'metro', popularity: 1 },
  { sku: 'ELC-002', name: 'LED Bulb 9 W', category: 'ELC', brand: 'VoltEdge', unit: 'pcs', hsnCode: '8539', gstRate: 18, mrp: 99, margin: 0.25, supplier: 'metro', popularity: 1, season: 'festival' },
  { sku: 'ELC-003', name: 'USB-C Charging Cable 1 m', category: 'ELC', brand: 'VoltEdge', unit: 'pcs', hsnCode: '8544', gstRate: 18, mrp: 299, margin: 0.35, supplier: 'metro', popularity: 0.5 },
  { sku: 'ELC-004', name: 'Wired Earphones', category: 'ELC', brand: 'VoltEdge', unit: 'pcs', hsnCode: '8518', gstRate: 18, mrp: 399, margin: 0.35, supplier: 'metro', popularity: 0.5, deadForDays: 120 },
];

export interface FestivalDef extends Festival {
  /** Peak multiplier on store footfall. */
  footfall: number;
  /** Peak multiplier on products with season "festival". */
  festiveGoods: number;
}

/** How strongly each festival moves the simulated shop; the dates come from the shared calendar. */
const FESTIVAL_EFFECTS: Record<string, { footfall: number; festiveGoods: number }> = {
  Dussehra: { footfall: 1.3, festiveGoods: 2 },
  Diwali: { footfall: 1.8, festiveGoods: 4 },
  Christmas: { footfall: 1.2, festiveGoods: 1.5 },
  'Makar Sankranti': { footfall: 1.2, festiveGoods: 2 },
  Holi: { footfall: 1.3, festiveGoods: 2 },
  'Eid al-Fitr': { footfall: 1.3, festiveGoods: 2.5 },
  'Raksha Bandhan': { footfall: 1.2, festiveGoods: 2 },
  'Ganesh Chaturthi': { footfall: 1.4, festiveGoods: 2.5 },
};

export const FESTIVALS: readonly FestivalDef[] = FESTIVAL_CALENDAR.map((f) => {
  const effect = FESTIVAL_EFFECTS[f.name];
  if (!effect) throw new Error(`No simulated effect for ${f.name}`);
  // Dussehra 2026 and 2027 fall close to Diwali, so their own lift is a little smaller.
  return f.name === 'Dussehra' && f.date > '2026-01-01'
    ? { ...f, footfall: 1.25, festiveGoods: 1.8 }
    : { ...f, ...effect };
});

export const FIRST_NAMES = [
  'Aarav',
  'Aditi',
  'Akash',
  'Ananya',
  'Arjun',
  'Bhavana',
  'Chetan',
  'Divya',
  'Ganesh',
  'Harini',
  'Imran',
  'Jyothi',
  'Karthik',
  'Kavya',
  'Lokesh',
  'Meera',
  'Mohan',
  'Nandini',
  'Naveen',
  'Pooja',
  'Pradeep',
  'Ramya',
  'Ravi',
  'Sahana',
  'Sandeep',
  'Shreya',
  'Sunil',
  'Tanvi',
  'Varun',
  'Zoya',
] as const;

export const LAST_NAMES = [
  'Acharya',
  'Bhat',
  'D’Souza',
  'Gowda',
  'Hegde',
  'Iyer',
  'Joshi',
  'Kamath',
  'Khan',
  'Kumar',
  'Menon',
  'Murthy',
  'Naidu',
  'Patil',
  'Pillai',
  'Rao',
  'Reddy',
  'Shenoy',
  'Singh',
  'Verma',
] as const;

export interface BusinessCustomerDef {
  name: string;
  gstinBody: string;
  stateCode: StateCode;
  city: string;
  pincode: string;
  phone: string;
  /** Average bills per week. */
  visitsPerWeek: number;
}

// prettier-ignore
export const BUSINESS_CUSTOMERS: readonly BusinessCustomerDef[] = [
  { name: 'Green Leaf Café', gstinBody: '29AAFFG1111A1Z', stateCode: '29', city: 'Bengaluru', pincode: '560038', phone: '9731100001', visitsPerWeek: 2 },
  { name: 'Sunrise Boys Hostel', gstinBody: '29AAATS2222B1Z', stateCode: '29', city: 'Bengaluru', pincode: '560008', phone: '9731100002', visitsPerWeek: 1 },
  { name: 'Sharma Caterers', gstinBody: '29ABCPS3333C1Z', stateCode: '29', city: 'Bengaluru', pincode: '560075', phone: '9731100003', visitsPerWeek: 1 },
  { name: 'Hosur Mini Mart', gstinBody: '33AAFFH4444D1Z', stateCode: '33', city: 'Hosur', pincode: '635109', phone: '9731100004', visitsPerWeek: 0.5 },
];

export const RETURN_REASONS = [
  { reason: 'Damaged packaging', restock: false },
  { reason: 'Expired product', restock: false },
  { reason: 'Wrong item picked', restock: true },
  { reason: 'Customer changed mind', restock: true },
] as const;

export const ADJUSTMENTS = [
  { reason: 'damaged', note: 'Damaged in storage' },
  { reason: 'expired', note: 'Expired, written off' },
  { reason: 'count', note: 'Stock count correction' },
] as const;
