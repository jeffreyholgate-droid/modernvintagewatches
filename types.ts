
export enum Category {
  WATCH = 'WATCH',
  HANDBAG = 'HANDBAG',
  JEWELLERY = 'JEWELLERY'
}

export enum PublishState {
  PUBLISHED = 'PUBLISHED',
  UNPUBLISHED = 'UNPUBLISHED',
  DRAFT = 'DRAFT'
}

export interface NormalizedData {
  brand: string;
  model: string;
  reference?: string;
  year?: string;
  material?: string;
  condition: string;
  authenticityGuaranteed: boolean;
}

export interface CopyData {
  sales_title: string;
  bullets: string[];
  long_description: string;
  seo_title: string;
  seo_description: string;
}

export interface Product {
  id: string;
  brand: string;
  model: string;
  ref: string;
  price: number;
  year: string;
  image: string;
  condition: string;
}

// Added EbayItem interface to match the data structure used in server/ebay.ts
export interface EbayItem {
  id: string;
  ebayItemId: string;
  url: string;
  titleRaw: string;
  priceGbp: number;
  shippingGbp: number;
  sellerName: string;
  sellerFeedbackPercent: number;
  sellerFeedbackScore: number;
  category: Category;
  locationCountry: string;
  imageUrls: string[];
  status: string;
  lastSeenAt: string;
  firstSeenAt: string;
}
