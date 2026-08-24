/**
 * ClipForge AI - Live WebSocket Client
 * يجيب بيانات حية كل ثانية من المنصات مباشرة + من سيرفرنا
 */

class LiveWebSocketClient {
  constructor() {
    this.ws = null;
    this.exchangeSockets = new Map(); // WebSocket لكل منصة
    this.callbacks = {
      onSignal: null,
      onLiveUpdate: null,
      onExchangeData: null,
      onStatus: null
    };
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.liveCandles = new Map(); // cache للشموع الحية
  }

  // اتصال بسيرفرنا WebSocket (يبث إشارات كل ثانية)
  connectToServer() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    // السيرفر على بورت 8081، لكن في Preview يجي عبر نفس الهوست
    // نحاول 8081 ثم fallback لـ 8080
    const wsUrl = `${protocol}//${host}:8081`;
    
    console.log(`🔌 Connecting to Live Server: ${wsUrl}`);
    
    try {
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        console.log('✅ Connected to ClipForge Live Server');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        if (this.callbacks.onStatus) this.callbacks.onStatus('connected', 'متصل بالسيرفر الحي');

        // اشترك في كل الإشارات
        this.ws.send(JSON.stringify({
          type: 'subscribe_all',
          timeframe: '15m',
          strategy: 'all'
        }));
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          
          if (msg.type === 'live_update') {
            console.log(`📡 Live update: ${msg.count} signals`);
            if (this.callbacks.onLiveUpdate) this.callbacks.onLiveUpdate(msg);
          }
          
          if (msg.type === 'signals' || msg.type === 'all_signals') {
            if (this.callbacks.onSignal) this.callbacks.onSignal(msg.signals);
          }
        } catch (e) {
          console.error('WS parse error:', e);
        }
      };

      this.ws.onclose = () => {
        console.log('🔌 Disconnected from Live Server');
        this.isConnected = false;
        if (this.callbacks.onStatus) this.callbacks.onStatus('disconnected', 'غير متصل');
        this.reconnect();
      };

      this.ws.onerror = (err) => {
        console.warn('WS error, will use browser direct mode:', err);
        if (this.callbacks.onStatus) this.callbacks.onStatus('browser_mode', 'وضع المتصفح المباشر');
        // Fallback: استعمل وضع المتصفح المباشر
        this.startBrowserDirectMode();
      };
    } catch (e) {
      console.warn('WS connect failed, using browser direct mode:', e);
      this.startBrowserDirectMode();
    }
  }

  reconnect() {
    if (this.reconnectAttempts >= 5) {
      console.log('❌ Max reconnect attempts, switching to browser mode');
      this.startBrowserDirectMode();
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectAttempts * 2000;
    console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => this.connectToServer(), delay);
  }

  // وضع المتصفح المباشر - يجيب من المنصات مباشرة كل ثانية
  startBrowserDirectMode() {
    console.log('🌐 Starting Browser Direct Live Mode - fetching from exchanges every second');
    if (this.callbacks.onStatus) this.callbacks.onStatus('browser_live', 'مباشر من المنصات كل ثانية 🔥');

    // كل ثانية، حدث شمعة واحدة عشوائية لمحاكاة Live
    // في الإنتاج، هنا تربط WebSocket حقيقي لكل منصة
    setInterval(async () => {
      // حاول جلب سعر حقيقي من CoinGecko كل ثانية
      try {
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd');
        const data = await res.json();
        
        const livePrices = {
          'BTC/USDT': data.bitcoin?.usd,
          'ETH/USDT': data.ethereum?.usd,
          'SOL/USDT': data.solana?.usd
        };

        if (this.callbacks.onExchangeData) {
          this.callbacks.onExchangeData({
            type: 'price_update',
            prices: livePrices,
            timestamp: Date.now(),
            source: 'coingecko-live'
          });
        }
      } catch (e) {
        // ignore
      }
    }, 1000);

    // كل 5 ثواني، جلب شموع حقيقية
    setInterval(async () => {
      if (window.realDataFetcher) {
        const exchanges = ['binance', 'okx', 'kraken'];
        for (const exId of exchanges) {
          try {
            await window.realDataFetcher.fetchRealCandles(exId, 'BTC/USDT', '15m');
          } catch (e) {}
          await new Promise(r => setTimeout(r, 200));
        }
      }
    }, 5000);
  }

  // اتصال مباشر بـ Binance WebSocket (حقيقي)
  connectBinanceLive(symbol = 'btcusdt') {
    const wsUrl = `wss://data-stream.binance.vision/ws/${symbol}@kline_15m`;
    console.log(`📡 Connecting to Binance Live: ${wsUrl}`);

    try {
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log(`✅ Binance Live connected for ${symbol}`);
        if (this.callbacks.onStatus) this.callbacks.onStatus('binance_live', `Binance مباشر ${symbol.toUpperCase()}`);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.k) {
            const kline = data.k;
            const candle = {
              time: kline.t,
              open: parseFloat(kline.o),
              high: parseFloat(kline.h),
              low: parseFloat(kline.l),
              close: parseFloat(kline.c),
              volume: parseFloat(kline.v),
              isFinal: kline.x // هل الشمعة اكتملت؟
            };

            if (this.callbacks.onExchangeData) {
              this.callbacks.onExchangeData({
                type: 'binance_kline',
                symbol: symbol.toUpperCase(),
                candle,
                timestamp: Date.now(),
                source: 'binance-ws-live'
              });
            }

            // حدث الكاش
            this.liveCandles.set(`binance_${symbol}`, candle);
          }
        } catch (e) {
          console.error('Binance WS parse error:', e);
        }
      };

      ws.onerror = (e) => console.warn('Binance WS error:', e);
      ws.onclose = () => {
        console.log('Binance WS closed, reconnecting in 3s');
        setTimeout(() => this.connectBinanceLive(symbol), 3000);
      };

      this.exchangeSockets.set(`binance_${symbol}`, ws);
      return ws;
    } catch (e) {
      console.warn('Binance WS failed:', e);
      return null;
    }
  }

  // اتصال OKX WebSocket
  connectOKXLive() {
    const wsUrl = 'wss://ws.okx.com:8443/ws/v5/public';
    console.log(`📡 Connecting to OKX Live: ${wsUrl}`);

    try {
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log('✅ OKX Live connected');
        // اشترك في BTC-USDT ticker
        ws.send(JSON.stringify({
          op: 'subscribe',
          args: [{ channel: 'tickers', instId: 'BTC-USDT' }, { channel: 'candle15m', instId: 'BTC-USDT' }]
        }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.data && data.data[0]) {
            if (this.callbacks.onExchangeData) {
              this.callbacks.onExchangeData({
                type: 'okx_ticker',
                data: data.data[0],
                timestamp: Date.now(),
                source: 'okx-ws-live'
              });
            }
          }
        } catch (e) {}
      };

      ws.onerror = (e) => console.warn('OKX WS error:', e);
      ws.onclose = () => {
        console.log('OKX WS closed, reconnecting');
        setTimeout(() => this.connectOKXLive(), 3000);
      };

      this.exchangeSockets.set('okx', ws);
      return ws;
    } catch (e) {
      console.warn('OKX WS failed:', e);
      return null;
    }
  }

  // إعداد callbacks
  on(event, callback) {
    this.callbacks[event] = callback;
  }

  // إرسال اشتراك
  subscribe(exchangeId, timeframe = '15m', strategy = 'all') {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'subscribe',
        exchangeId,
        timeframe,
        strategy
      }));
    }
  }

  // إيقاف كل شيء
  disconnect() {
    if (this.ws) this.ws.close();
    for (const ws of this.exchangeSockets.values()) {
      ws.close();
    }
    this.exchangeSockets.clear();
  }
}

window.liveWebSocket = new LiveWebSocketClient();
