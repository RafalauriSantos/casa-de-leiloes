/**
 * The demo accounts the seed creates (the brief: "deixe semeados um leiloeiro, dois clientes"). The password is shared
 * by these three accounts only and is public on purpose: the README and the login screen show it (D9c).
 */
export const DEMO_ACCOUNTS = {
  password: 'demo-leilao-2026',
  auctioneer: 'leiloeiro@demo.example',
  bidders: ['licitante1@demo.example', 'licitante2@demo.example'],
} as const;
