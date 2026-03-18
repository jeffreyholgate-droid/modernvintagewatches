import { Category, EbayItem } from "../types.js";

type EbayBrowseSearchResponse = {
  itemSummaries?: EbayBrowseItem[];
};

type EbayBrowseItem = {
  itemId?: string;
  title?: string;
  shortDescription?: string;
  itemWebUrl?: string;
  buyingOptions?: string[];
  image?: { imageUrl?: string };
  additionalImages?: Array<{ imageUrl?: string }>;
  price?: { value?: string; currency?: string };
  currentBidPrice?: { value?: string; currency?: string };
  itemLocation?: {
    country?: string;
    postalCode?: string;
  };
  seller?: {
    username?: string;
    feedbackPercentage?: string | number;
    feedbackScore?: string | number;
  };
};

type EbayOAuthResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

export class EbayClient {
  private mode: 'REAL' | 'MOCK';

  constructor() {
    this.mode =
      process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET
        ? 'REAL'
        : 'MOCK';
  }

  async searchItems(category: Category, priceMin: number, priceMax: number): Promise<EbayItem[]> {
    if (this.mode !== 'REAL') {
      return this.generateMockItems(category, priceMin, priceMax);
    }

    if (category !== Category.WATCH) {
      return [];
    }

    const token = await this.getAccessToken();

    const query = 'watch';

    const marketplaceId = process.env.EBAY_MARKETPLACE_ID || 'EBAY_GB';
    const baseUrl =
      (process.env.EBAY_ENV || 'production').toLowerCase() === 'sandbox'
        ? 'https://api.sandbox.ebay.com'
        : 'https://api.ebay.com';

    const url = new URL(`${baseUrl}/buy/browse/v1/item_summary/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '50');
    url.searchParams.set(
  'filter',
  [
    `price:[${priceMin}..${priceMax}]`,
    'priceCurrency:GBP',
    'itemLocationCountry:GB',
  ].join(',')
);
    url.searchParams.set('sort', 'newlyListed');
    url.searchParams.set('category_ids', '31387');

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`eBay Browse search failed: ${response.status} ${text}`);
    }

    const json = (await response.json()) as EbayBrowseSearchResponse;
    const items = Array.isArray(json.itemSummaries) ? json.itemSummaries : [];

    return items
      .filter((item) => this.isAllowedWatchListing(item, priceMin, priceMax))
      .map((item) => this.mapBrowseItemToEbayItem(item, category))
      .filter((item): item is EbayItem => Boolean(item));
  }

  async verifyItem(itemId: string): Promise<boolean> {
    return Math.random() > 0.1;
  }

  private async getAccessToken(): Promise<string> {
    const clientId = process.env.EBAY_CLIENT_ID;
    const clientSecret = process.env.EBAY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET');
    }

    const baseUrl =
      (process.env.EBAY_ENV || 'production').toLowerCase() === 'sandbox'
        ? 'https://api.sandbox.ebay.com'
        : 'https://api.ebay.com';

    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    });

    const response = await fetch(`${baseUrl}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`eBay OAuth failed: ${response.status} ${text}`);
    }

    const json = (await response.json()) as EbayOAuthResponse;

    if (!json.access_token) {
      throw new Error('eBay OAuth response did not include an access token');
    }

    return json.access_token;
  }

  private isAllowedWatchListing(item: EbayBrowseItem, priceMin: number, priceMax: number): boolean {
    const title = String(item?.title || '').toLowerCase();
    const description = String(item?.shortDescription || '').toLowerCase();
    const text = `${title} ${description}`;

    const blockedTerms = [
      'replica',
      'fake',
      'homage',
      'mod',
      'modded',
      'aftermarket',
      'redial',
      'for parts',
      'for spares',
      'spares or repair',
      'spares & repair',
      'broken',
      'not working',
      'parts only',
      'custom dial',
      'refinished dial',
    ];

    if (blockedTerms.some((term) => text.includes(term))) {
      return false;
    }

    const country = item?.itemLocation?.country;
    if (country !== 'GB') {
      return false;
    }

    const buyingOptions = Array.isArray(item?.buyingOptions) ? item.buyingOptions : [];
    if (!buyingOptions.includes('FIXED_PRICE')) {
      return false;
    }

    const rawPrice = item?.price?.value ?? item?.currentBidPrice?.value;
    const price = Number(rawPrice);

    if (!Number.isFinite(price)) {
      return false;
    }

    if (price < priceMin || price > priceMax) {
      return false;
    }

    if (!item?.itemId || !item?.itemWebUrl || !item?.title) {
      return false;
    }

    return true;
  }

  private mapBrowseItemToEbayItem(item: EbayBrowseItem, category: Category): EbayItem | null {
    if (!item.itemId || !item.itemWebUrl || !item.title) {
      return null;
    }

    const rawPrice = item?.price?.value ?? item?.currentBidPrice?.value ?? 0;

    const imageUrls = [
      item?.image?.imageUrl,
      ...(Array.isArray(item?.additionalImages)
        ? item.additionalImages.map((img) => img?.imageUrl)
        : []),
    ].filter((url): url is string => Boolean(url));

    return {
      id: `ebay_${item.itemId}`,
      ebayItemId: item.itemId,
      url: item.itemWebUrl,
      titleRaw: item.title,
      priceGbp: Number(rawPrice) || 0,
      shippingGbp: 0,
      sellerName: item?.seller?.username || 'unknown',
      sellerFeedbackPercent: Number(item?.seller?.feedbackPercentage || 0),
      sellerFeedbackScore: Number(item?.seller?.feedbackScore || 0),
      category,
      locationCountry: item?.itemLocation?.country || 'GB',
      imageUrls,
      status: 'ACTIVE',
      lastSeenAt: new Date().toISOString(),
      firstSeenAt: new Date().toISOString(),
    };
  }

  private generateMockItems(category: Category, min: number, max: number): EbayItem[] {
    const items: EbayItem[] = [];
    const count = 15;

    const brandData: Record<Category, { brands: string[]; imgs: string[] }> = {
      [Category.WATCH]: {
        brands: ['Rolex', 'Omega', 'Cartier', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille'],
        imgs: [
          'https://images.unsplash.com/photo-1547996160-81dfa63595dd',
          'https://images.unsplash.com/photo-1614164185128-e4ec99c436d7',
          'https://images.unsplash.com/photo-1523170335258-f5ed11844a49',
          'https://images.unsplash.com/photo-1524592094714-0f0654e20314',
        ],
      },
      [Category.HANDBAG]: {
        brands: ['Hermès Birkin', 'Chanel Classic', 'LV Keepall', 'Gucci Jackie', 'Dior Lady'],
        imgs: [
          'https://images.unsplash.com/photo-1584917865442-de89df76afd3',
          'https://images.unsplash.com/photo-1548036328-c9fa89d128fa',
          'https://images.unsplash.com/photo-1591348278863-a8fb3887e2aa',
        ],
      },
      [Category.JEWELLERY]: {
        brands: ['Cartier Love', 'Tiffany T-Square', 'VCA Alhambra', 'Bvlgari Serpenti'],
        imgs: [
          'https://images.unsplash.com/photo-1602173574767-37ac01994b2a',
          'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338',
          'https://images.unsplash.com/photo-1605100804763-247f67b3557e',
        ],
      },
    };

    const noisePrefixes = ["!!!", "RARE", "GRAIL", "STUNNING", "L@@K", "MINT", "FULL SET"];

    for (let i = 0; i < count; i++) {
      const data = brandData[category];
      const brand = data.brands[Math.floor(Math.random() * data.brands.length)];
      const img = data.imgs[Math.floor(Math.random() * data.imgs.length)] + `?q=80&w=800&auto=format`;
      const price = Math.floor(Math.random() * (max - min)) + min;
      const noise = noisePrefixes[Math.floor(Math.random() * noisePrefixes.length)];

      items.push({
        id: `ebay_${Math.random().toString(36).substr(2, 9)}`,
        ebayItemId: `item_${Math.random().toString(10).substr(2, 12)}`,
        url: 'https://ebay.co.uk/itm/mock',
        titleRaw: `${noise} ${brand.toUpperCase()} AUTHENTIC ${Math.floor(Math.random() * 10) + 2015} - INVESTOR PIECE`,
        priceGbp: price,
        shippingGbp: 0,
        sellerName: `${brand.split(' ')[0]}_Specialist_UK`,
        sellerFeedbackPercent: 99.0 + (Math.random() * 1.0),
        sellerFeedbackScore: Math.floor(Math.random() * 8000) + 500,
        category: category,
        locationCountry: 'GB',
        imageUrls: [img],
        status: 'ACTIVE',
        lastSeenAt: new Date().toISOString(),
        firstSeenAt: new Date(Date.now() - 86400000 * 3).toISOString(),
      });
    }

    return items;
  }
}
