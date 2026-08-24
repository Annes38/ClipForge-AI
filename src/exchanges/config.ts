/**
 * ClipForge AI - 6 Exchanges Configuration
 * كل منصة بمشروعها وحدو
 */

export interface ExchangeConfig {
  id: string;
  name: string;
  displayName: string;
  logo: string; // emoji or url
  color: string; // tailwind color
  bgGradient: string;
  description: string;
  description_ar: string;
  website: string;
  fees: string;
  supportedSymbols: string[];
  features: string[];
  features_ar: string[];
  status: 'online' | 'offline' | 'maintenance';
  volume24h: string; // mock
  trustScore: number; // 0-100
}

export const EXCHANGES: ExchangeConfig[] = [
  {
    id: 'binance',
    name: 'Binance',
    displayName: 'Binance',
    logo: '🟡',
    color: 'yellow',
    bgGradient: 'from-yellow-500 to-yellow-700',
    description: 'World #1 exchange by volume',
    description_ar: 'أكبر منصة في العالم من حيث الحجم',
    website: 'https://binance.com',
    fees: '0.1% Spot',
    supportedSymbols: ['BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT', 'XRP/USDT', 'ADA/USDT'],
    features: ['Spot', 'Futures', 'Options', 'Earn'],
    features_ar: ['تداول فوري', 'عقود آجلة', 'خيارات', 'ربح'],
    status: 'online',
    volume24h: '$28.5B',
    trustScore: 98
  },
  {
    id: 'bybit',
    name: 'Bybit',
    displayName: 'Bybit',
    logo: '🟠',
    color: 'orange',
    bgGradient: 'from-orange-500 to-orange-700',
    description: 'Pro derivatives exchange',
    description_ar: 'منصة احترافية للمشتقات',
    website: 'https://bybit.com',
    fees: '0.1% Spot',
    supportedSymbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'AVAX/USDT', 'MATIC/USDT', 'DOT/USDT'],
    features: ['Derivatives', 'Spot', 'Copy Trading'],
    features_ar: ['مشتقات', 'فوري', 'نسخ تداول'],
    status: 'online',
    volume24h: '$8.2B',
    trustScore: 95
  },
  {
    id: 'okx',
    name: 'OKX',
    displayName: 'OKX',
    logo: '⚫',
    color: 'gray',
    bgGradient: 'from-gray-700 to-black',
    description: 'Advanced trading tools',
    description_ar: 'أدوات تداول متقدمة',
    website: 'https://okx.com',
    fees: '0.08% Spot',
    supportedSymbols: ['BTC/USDT', 'ETH/USDT', 'OKB/USDT', 'SOL/USDT', 'ARB/USDT', 'OP/USDT'],
    features: ['Spot', 'Futures', 'Web3 Wallet'],
    features_ar: ['فوري', 'آجلة', 'محفظة Web3'],
    status: 'online',
    volume24h: '$6.1B',
    trustScore: 93
  },
  {
    id: 'coinbase',
    name: 'Coinbase',
    displayName: 'Coinbase Pro',
    logo: '🔵',
    color: 'blue',
    bgGradient: 'from-blue-500 to-blue-700',
    description: 'US regulated & secure',
    description_ar: 'منصة أمريكية منظمة وآمنة',
    website: 'https://coinbase.com',
    fees: '0.5% Spot',
    supportedSymbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'AVAX/USDT', 'LINK/USDT', 'UNI/USDT'],
    features: ['Spot', 'Staking', 'Institutional'],
    features_ar: ['فوري', 'تخزين', 'مؤسساتي'],
    status: 'online',
    volume24h: '$4.8B',
    trustScore: 97
  },
  {
    id: 'kraken',
    name: 'Kraken',
    displayName: 'Kraken',
    logo: '🟣',
    color: 'purple',
    bgGradient: 'from-purple-500 to-purple-700',
    description: 'Most secure exchange',
    description_ar: 'أكثر منصة أماناً',
    website: 'https://kraken.com',
    fees: '0.26% Spot',
    supportedSymbols: ['BTC/USDT', 'ETH/USDT', 'DOT/USDT', 'ADA/USDT', 'LINK/USDT', 'XLM/USDT'],
    features: ['Spot', 'Futures', 'Margin'],
    features_ar: ['فوري', 'آجلة', 'هامش'],
    status: 'online',
    volume24h: '$1.2B',
    trustScore: 96
  },
  {
    id: 'bitget',
    name: 'Bitget',
    displayName: 'Bitget',
    logo: '🔷',
    color: 'cyan',
    bgGradient: 'from-cyan-500 to-blue-600',
    description: 'Copy trading leader',
    description_ar: 'رائدة في نسخ التداول',
    website: 'https://bitget.com',
    fees: '0.1% Spot',
    supportedSymbols: ['BTC/USDT', 'ETH/USDT', 'BGB/USDT', 'SOL/USDT', 'PEPE/USDT', 'SHIB/USDT'],
    features: ['Copy Trading', 'Spot', 'Futures'],
    features_ar: ['نسخ تداول', 'فوري', 'آجلة'],
    status: 'online',
    volume24h: '$3.4B',
    trustScore: 90
  }
];

export function getExchangeById(id: string): ExchangeConfig | undefined {
  return EXCHANGES.find(e => e.id === id);
}

export function getAllExchangeIds(): string[] {
  return EXCHANGES.map(e => e.id);
}
