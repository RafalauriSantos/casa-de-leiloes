const EVENT = 'casa:wallet-changed';

/** Tells the screen that a deposit or a bid just changed the wallet, so the balance in the header is read again. */
export function announceWalletChange(): void {
  window.dispatchEvent(new Event(EVENT));
}

export function onWalletChange(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => { window.removeEventListener(EVENT, listener); };
}
