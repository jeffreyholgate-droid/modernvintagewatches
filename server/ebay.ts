
import { Category, EbayItem } from "../types";

export class EbayClient {
  private mode: 'REAL' | 'MOCK';

  constructor() {
    this.mode = (process.env.EBAY_APP_ID && process.env.EBAY_CERT_ID) ? 'REAL' : 'MOCK';
  }

  async searchItems(category: Category, priceMin: number, priceMax: number): Promise<EbayItem[]> {
    return this.generateMockItems(category, priceMin, priceMax);
  }

  async verifyItem(itemId: string): Promise<boolean> {
    return Math.random() > 0.1;
  }

  private generateMockItems(category: Category, min: number, max: number): EbayItem[] {
    const items: EbayItem[] = [];
    const count = 15;

    const brandData: Record<Category, { brands: string[], imgs: string[] }> = {
      [Category.WATCH]: {
        brands: ['Rolex', 'Omega', 'Cartier', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille'],
        imgs: [
          'https://images.unsplash.com/photo-1547996160-81dfa63595dd',
          'https://images.unsplash.com/photo-1614164185128-e4ec99c436d7',
          'https://images.unsplash.com/photo-1523170335258-f5ed11844a49',
          'https://images.unsplash.com/photo-1524592094714-0f0654e20314'
        ]
      },
      [Category.HANDBAG]: {
        brands: ['Hermès Birkin', 'Chanel Classic', 'LV Keepall', 'Gucci Jackie', 'Dior Lady'],
        imgs: [
          'https://images.unsplash.com/photo-1584917865442-de89df76afd3',
          'https://images.unsplash.com/photo-1548036328-c9fa89d128fa',
          'https://images.unsplash.com/photo-1591348278863-a8fb3887e2aa'
        ]
      },
      [Category.JEWELLERY]: {
        brands: ['Cartier Love', 'Tiffany T-Square', 'VCA Alhambra', 'Bvlgari Serpenti'],
        imgs: [
          'https://images.unsplash.com/photo-1602173574767-37ac01994b2a',
          'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338',
          'https://images.unsplash.com/photo-1605100804763-247f67b3557e'
        ]
      }
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
        titleRaw: `${noise} ${brand.toUpperCase()} AUTHENTIC ${Math.floor(Math.random()*10) + 2015} - INVESTOR PIECE`,
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
