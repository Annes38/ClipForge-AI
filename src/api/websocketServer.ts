/**
 * ClipForge AI - WebSocket Live Server
 * يبث إشارات حية كل ثانية
 */

import { WebSocketServer, WebSocket } from 'ws';
import { StrategyManager } from '../strategies';
import { exchangeService } from '../exchanges/exchangeService';
import { EXCHANGES } from '../exchanges/config';
import { Timeframe } from '../engine/types';

export class LiveWebSocketServer {
  private wss: WebSocketServer | null = null;
  private strategyManager = new StrategyManager();
  private clients: Set<WebSocket> = new Set();
  private interval: NodeJS.Timeout | null = null;

  start(port: number = 8081) {
    this.wss = new WebSocketServer({ port, host: '0.0.0.0' });

    this.wss.on('connection', (ws: WebSocket, req) => {
      console.log('🔌 New WebSocket client connected');
      this.clients.add(ws);

      // أرسل قائمة المنصات مباشرة
      ws.send(JSON.stringify({
        type: 'exchanges',
        data: EXCHANGES.map(e => ({ id: e.id, name: e.name, logo: e.logo })),
        timestamp: Date.now()
      }));

      ws.on('message', async (message: string) => {
        try {
          const msg = JSON.parse(message.toString());
          
          if (msg.type === 'subscribe') {
            const { exchangeId, timeframe, strategy } = msg;
            console.log(`📡 Client subscribed to ${exchangeId} ${timeframe} ${strategy}`);
            
            // أرسل إشارات فورية
            const signals = await this.getSignalsForExchange(exchangeId, timeframe, strategy);
            ws.send(JSON.stringify({
              type: 'signals',
              exchangeId,
              timeframe,
              signals,
              timestamp: Date.now()
            }));
          }

          if (msg.type === 'subscribe_all') {
            const { timeframe, strategy } = msg;
            const allSignals = await this.getAllSignals(timeframe, strategy);
            ws.send(JSON.stringify({
              type: 'all_signals',
              signals: allSignals,
              timestamp: Date.now()
            }));
          }

          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          }
        } catch (e: any) {
          ws.send(JSON.stringify({ type: 'error', message: e.message }));
        }
      });

      ws.on('close', () => {
        console.log('🔌 Client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (err) => {
        console.error('WebSocket error:', err);
        this.clients.delete(ws);
      });
    });

    // بث كل ثانية
    this.startLiveBroadcast();

    console.log(`🌐 WebSocket Live Server running on ws://0.0.0.0:${port}`);
    console.log(`📡 Broadcasting signals every second to ${this.clients.size} clients`);
  }

  private startLiveBroadcast() {
    this.interval = setInterval(async () => {
      if (this.clients.size === 0) return;

      try {
        // جيب إشارات كل المنصات
        const allSignals = await this.getAllSignals('15m', 'all');
        
        const message = JSON.stringify({
          type: 'live_update',
          signals: allSignals.slice(0, 10), // أقوى 10 إشارات
          count: allSignals.length,
          timestamp: Date.now(),
          serverTime: new Date().toISOString()
        });

        // أرسل لكل العملاء
        for (const client of this.clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        }
      } catch (e) {
        console.error('Broadcast error:', e);
      }
    }, 1000); // كل ثانية
  }

  private async getSignalsForExchange(exchangeId: string, timeframe: Timeframe = '15m', strategy: any = 'all') {
    try {
      const candlesMap = await exchangeService.fetchAllCandlesForExchange(exchangeId, timeframe);
      const signals: any[] = [];

      for (const [symbol, candles] of candlesMap.entries()) {
        const signal = this.strategyManager.executeStrategy(strategy, candles, symbol, timeframe);
        if (signal) {
          signals.push({
            ...signal,
            exchangeId,
            exchangeName: exchangeService.getExchangeConfig(exchangeId)?.name
          });
        }
      }

      return signals.sort((a, b) => b.confidence - a.confidence);
    } catch (e) {
      console.error(`Error getting signals for ${exchangeId}:`, e);
      return [];
    }
  }

  private async getAllSignals(timeframe: Timeframe = '15m', strategy: any = 'all') {
    const all: any[] = [];
    
    for (const exchange of EXCHANGES) {
      const signals = await this.getSignalsForExchange(exchange.id, timeframe, strategy);
      all.push(...signals);
    }

    return all.sort((a, b) => b.confidence - a.confidence);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    if (this.wss) this.wss.close();
    console.log('WebSocket server stopped');
  }
}
